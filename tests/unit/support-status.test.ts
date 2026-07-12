import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Public service-status: lib/support-status.computeSupportStatus (the mapping)
// + the GET /api/public/support/status route (auth/flag/shape). We NEVER hit
// real monitoring — the two read-only clients (@/lib/alertmanager, @/lib/uptime)
// are mocked so we can drive: firing critical → down, firing warning → degraded,
// all-clear → operational, missing-config → operational/default, and a source
// error → safe operational fallback. The route is also checked to gate on the
// support token + HERMES_INTAKE_ENABLED and to never 500 on a monitoring failure.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => ({
  getActiveAlerts: vi.fn(),
  getUptimeStatus: vi.fn(),
}));

vi.mock('@/lib/alertmanager', () => ({ getActiveAlerts: H.getActiveAlerts }));
vi.mock('@/lib/uptime', () => ({ getUptimeStatus: H.getUptimeStatus }));

import {
  computeSupportStatus,
  __resetSupportStatusCache,
} from '@/lib/support-status';

const groups = (over: Partial<Record<string, number>> = {}) => ({
  critical: 0,
  warning: 0,
  info: 0,
  other: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetSupportStatusCache();
});

describe('computeSupportStatus — Alertmanager mapping (primary source)', () => {
  it('firing CRITICAL alert → down', async () => {
    H.getActiveAlerts.mockResolvedValue({
      ok: true,
      groups: groups({ critical: 1 }),
      alerts: [{ name: 'PostgresDown', severity: 'critical', summary: 'db down', startsAt: '' }],
    });
    const s = await computeSupportStatus();
    expect(s.status).toBe('down');
    expect(s.source).toBe('alertmanager');
    expect(s.components).toEqual([{ name: 'PostgresDown', status: 'down' }]);
    // Fallback source must not be consulted when Alertmanager answered.
    expect(H.getUptimeStatus).not.toHaveBeenCalled();
  });

  it('firing WARNING (no critical) → degraded', async () => {
    H.getActiveAlerts.mockResolvedValue({
      ok: true,
      groups: groups({ warning: 2 }),
      alerts: [
        { name: 'HighLatency', severity: 'warning', summary: '', startsAt: '' },
        { name: 'QueueBacklog', severity: 'warning', summary: '', startsAt: '' },
      ],
    });
    const s = await computeSupportStatus();
    expect(s.status).toBe('degraded');
    expect(s.source).toBe('alertmanager');
    expect(s.components.every((c) => c.status === 'degraded')).toBe(true);
  });

  it('no firing critical/warning alerts → operational', async () => {
    H.getActiveAlerts.mockResolvedValue({
      ok: true,
      groups: groups({ info: 3 }),
      alerts: [{ name: 'Heads up', severity: 'info', summary: '', startsAt: '' }],
    });
    const s = await computeSupportStatus();
    expect(s.status).toBe('operational');
    expect(s.source).toBe('alertmanager');
    // info alerts are not surfaced as degrading components
    expect(s.components).toEqual([]);
  });
});

describe('computeSupportStatus — Uptime-Kuma fallback', () => {
  it('falls back to Kuma when Alertmanager is unreachable; a down monitor → degraded', async () => {
    H.getActiveAlerts.mockResolvedValue({ ok: false, alerts: [], groups: groups(), note: 'unreachable' });
    H.getUptimeStatus.mockResolvedValue({
      ok: true,
      monitors: [
        { name: 'web', up: true, status: 1 },
        { name: 'worker', up: false, status: 0 },
      ],
    });
    const s = await computeSupportStatus();
    expect(s.status).toBe('degraded');
    expect(s.source).toBe('uptime-kuma');
    expect(s.components).toContainEqual({ name: 'worker', status: 'down' });
  });

  it('all Kuma monitors down → down', async () => {
    H.getActiveAlerts.mockResolvedValue({ ok: false, alerts: [], groups: groups(), note: 'unreachable' });
    H.getUptimeStatus.mockResolvedValue({
      ok: true,
      monitors: [{ name: 'web', up: false, status: 0 }],
    });
    const s = await computeSupportStatus();
    expect(s.status).toBe('down');
    expect(s.source).toBe('uptime-kuma');
  });

  it('all Kuma monitors up → operational', async () => {
    H.getActiveAlerts.mockResolvedValue({ ok: false, alerts: [], groups: groups(), note: 'unreachable' });
    H.getUptimeStatus.mockResolvedValue({
      ok: true,
      monitors: [{ name: 'web', up: true, status: 1 }],
    });
    const s = await computeSupportStatus();
    expect(s.status).toBe('operational');
    expect(s.source).toBe('uptime-kuma');
  });
});

describe('computeSupportStatus — missing config / safe fallback', () => {
  it('neither source reachable/configured → operational with source:default', async () => {
    H.getActiveAlerts.mockResolvedValue({ ok: false, alerts: [], groups: groups(), note: 'unreachable' });
    H.getUptimeStatus.mockResolvedValue({ ok: false, monitors: [], note: 'not configured (set UPTIME_KUMA_API_KEY)' });
    const s = await computeSupportStatus();
    expect(s.status).toBe('operational');
    expect(s.source).toBe('default');
    expect(s.components).toEqual([]);
    expect(s.note).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Route: GET /api/public/support/status — auth, flag, and never-500 contract.
// ---------------------------------------------------------------------------

const TOKEN = 'test-support-token';

function makeReq(headers: Record<string, string> = {}) {
  return new Request('https://ops.example.com/api/public/support/status', {
    method: 'GET',
    headers,
  });
}

async function loadRoute() {
  // Fresh module each time so env changes (flag/token) take effect and the
  // status cache is isolated.
  vi.resetModules();
  __resetSupportStatusCache();
  return await import('@/app/api/public/support/status/route');
}

describe('GET /api/public/support/status route', () => {
  beforeEach(() => {
    process.env.OPS_SUPPORT_TOKEN = TOKEN;
    process.env.HERMES_INTAKE_ENABLED = '1';
    delete process.env.SUPPORT_CORS_ALLOWED_ORIGINS;
    // default: all-clear
    H.getActiveAlerts.mockResolvedValue({ ok: true, groups: groups(), alerts: [] });
    H.getUptimeStatus.mockResolvedValue({ ok: false, monitors: [], note: 'n/a' });
  });

  it('401s without the support token', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('503s when intake is disabled even with a valid token', async () => {
    process.env.HERMES_INTAKE_ENABLED = '0';
    const { GET } = await loadRoute();
    const res = await GET(makeReq({ 'x-ingest-token': TOKEN }));
    expect(res.status).toBe(503);
  });

  it('returns the real operational status for an authed request', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeReq({ 'x-ingest-token': TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('operational');
    expect(body.source).toBe('alertmanager');
  });

  it('maps a firing critical alert to down (200, not 500)', async () => {
    H.getActiveAlerts.mockResolvedValue({
      ok: true,
      groups: groups({ critical: 1 }),
      alerts: [{ name: 'RedisDown', severity: 'critical', summary: '', startsAt: '' }],
    });
    const { GET } = await loadRoute();
    const res = await GET(makeReq({ 'x-ingest-token': TOKEN }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('down');
  });

  it('never 500s even if a monitoring client throws — degrades to operational/default', async () => {
    // Worst case beyond the clients' never-throw contract: both reject.
    H.getActiveAlerts.mockRejectedValue(new Error('boom'));
    H.getUptimeStatus.mockRejectedValue(new Error('boom'));
    const { GET } = await loadRoute();
    const res = await GET(makeReq({ 'x-ingest-token': TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('operational');
    expect(body.source).toBe('default');
  });
});
