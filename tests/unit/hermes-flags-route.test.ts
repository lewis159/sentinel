import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Core Hermes flags API (app/api/v2/admin/hermes/flags/route.ts).
//
// Proves, WITHOUT a real DB/auth backend:
//   • both methods are admin-gated (requireSectionApi('admin')),
//   • GET returns the resolved state for every core flag,
//   • POST rejects an UNKNOWN flag (400) and never writes,
//   • POST toggles a KNOWN flag → setRuntimeFlag + an allow-listed
//     integration.flag.set audit event, returns { ok: true }.
//
// auth + audit + the flag store are spies; the route logic is exercised honestly.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const requireSectionApi = vi.fn(async (_s: string) => null); // null = permitted
  const getSessionAccess = vi.fn(async () => ({ userId: 'admin1', role: 'global_admin' }));
  const appendAudit = vi.fn(async () => ({ rowHash: 'h', seq: 0 }) as any);
  const setRuntimeFlag = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
  const getRuntimeFlagState = vi.fn(async (flag: string) => ({
    flag,
    enabled: false,
    envDefault: false,
    source: 'env' as const,
  }));
  return { requireSectionApi, getSessionAccess, appendAudit, setRuntimeFlag, getRuntimeFlagState };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({
  requireSectionApi: h.requireSectionApi,
  getSessionAccess: h.getSessionAccess,
}));
vi.mock('@/lib/hermes/audit', () => ({ appendAudit: h.appendAudit }));

// Real registry keys + isKnownFlag semantics; write/read paths are spies.
vi.mock('@/lib/hermes/runtime-flags', () => {
  const RUNTIME_FLAG_DEFAULTS = {
    HERMES_BRAIN_ENABLED: () => false,
    HERMES_INTAKE_ENABLED: () => false,
    HERMES_KB_PGVECTOR: () => false,
    HERMES_INNGEST_ENABLED: () => false,
    HERMES_TELEGRAM_ENABLED: () => false,
  } as Record<string, () => boolean>;
  return {
    RUNTIME_FLAG_DEFAULTS,
    isKnownFlag: (f: string) => Object.prototype.hasOwnProperty.call(RUNTIME_FLAG_DEFAULTS, f),
    setRuntimeFlag: h.setRuntimeFlag,
    getRuntimeFlagState: h.getRuntimeFlagState,
  };
});

import { GET, POST } from '@/app/api/v2/admin/hermes/flags/route';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/v2/admin/hermes/flags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.requireSectionApi.mockClear();
  h.requireSectionApi.mockResolvedValue(null);
  h.getSessionAccess.mockClear();
  h.appendAudit.mockClear();
  h.setRuntimeFlag.mockClear();
  h.setRuntimeFlag.mockResolvedValue({ ok: true });
  h.getRuntimeFlagState.mockClear();
});

describe('admin gate', () => {
  it('GET is gated on admin', async () => {
    await GET();
    expect(h.requireSectionApi).toHaveBeenCalledWith('admin');
  });

  it('POST returns the denial response when the gate denies', async () => {
    const denial = new Response('forbidden', { status: 403 });
    h.requireSectionApi.mockResolvedValueOnce(denial as any);
    const res = await post({ flag: 'HERMES_BRAIN_ENABLED', enabled: true });
    expect(res.status).toBe(403);
  });
});

describe('GET — resolved state for every core flag', () => {
  it('returns one state per registered flag', async () => {
    const res = await GET();
    const body = await res.json();
    expect(Array.isArray(body.flags)).toBe(true);
    expect(body.flags).toHaveLength(5);
    expect(body.flags.map((f: any) => f.flag)).toContain('HERMES_BRAIN_ENABLED');
  });
});

describe('POST — validate, toggle, audit', () => {
  it('rejects an UNKNOWN flag and never writes', async () => {
    const res = await post({ flag: 'NOT_A_FLAG', enabled: true });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/unknown flag/i);
    expect(h.setRuntimeFlag).not.toHaveBeenCalled();
    expect(h.appendAudit).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean enabled', async () => {
    const res = await post({ flag: 'HERMES_BRAIN_ENABLED', enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(h.setRuntimeFlag).not.toHaveBeenCalled();
  });

  it('toggles a KNOWN flag → setRuntimeFlag + audit, returns ok', async () => {
    const res = await post({ flag: 'HERMES_BRAIN_ENABLED', enabled: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(h.setRuntimeFlag).toHaveBeenCalledWith('HERMES_BRAIN_ENABLED', true, 'admin1');

    const call = h.appendAudit.mock.calls.find((c) => c[0].action === 'integration.flag.set');
    expect(call).toBeTruthy();
    expect(call![0].detail).toMatchObject({ flag: 'HERMES_BRAIN_ENABLED', enabled: true });
  });

  it('surfaces a store error as 400 (no audit)', async () => {
    h.setRuntimeFlag.mockResolvedValueOnce({ ok: false, error: 'No database' });
    const res = await post({ flag: 'HERMES_BRAIN_ENABLED', enabled: true });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(h.appendAudit).not.toHaveBeenCalled();
  });
});
