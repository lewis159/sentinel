import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Console settings API (app/api/v2/settings/console/route.ts).
//
// Proves, WITHOUT a real DB/auth backend:
//   • both methods are admin-gated (requireSectionApi('admin')),
//   • GET returns BLANKS (empty settings) and never fabricates,
//   • POST validates the section + keys, persists, AUDITS console.settings.updated
//     recording section + KEYS only (never the values), and echoes back only the
//     re-read stored settings,
//   • POST rejects an unknown section, a foreign key, and an invalid value.
//
// auth + audit are spies; the store is mocked with an in-memory row map so the
// route's persistence path is exercised honestly.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const requireSectionApi = vi.fn(async (_s: string) => null); // null = permitted
  const getSessionAccess = vi.fn(async () => ({ userId: 'admin1', role: 'global_admin' }));
  const appendAudit = vi.fn(async () => ({ rowHash: 'h', seq: 0 }) as any);
  const rows = new Map<string, unknown>();
  return { requireSectionApi, getSessionAccess, appendAudit, rows };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({
  requireSectionApi: h.requireSectionApi,
  getSessionAccess: h.getSessionAccess,
}));
vi.mock('@/lib/hermes/audit', () => ({ appendAudit: h.appendAudit }));

// Mock the STORE directly (unit-level): honest in-memory behaviour that mirrors
// the real store's contract (blank map, validate on write, clear on blank).
vi.mock('@/lib/settings/store', async () => {
  const { validateSetting } = await import('@/lib/settings/schema');
  return {
    getSettings: vi.fn(async (keys?: string[]) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of h.rows.entries()) {
        if (keys && !keys.includes(k)) continue;
        out[k] = v;
      }
      return out;
    }),
    setSettings: vi.fn(async (entries: Record<string, unknown>) => {
      for (const k of Object.keys(entries)) {
        const c = validateSetting(k, entries[k]);
        if (!c.ok) return { ok: false, error: c.error, written: [] };
      }
      const written: string[] = [];
      for (const k of Object.keys(entries)) {
        const c = validateSetting(k, entries[k]) as any;
        if (c.unset) h.rows.delete(k);
        else h.rows.set(k, c.value);
        written.push(k);
      }
      return { ok: true, written };
    }),
  };
});

import { GET, POST } from '@/app/api/v2/settings/console/route';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/v2/settings/console', {
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
  h.rows.clear();
});

describe('admin gate', () => {
  it('GET is gated on admin', async () => {
    await GET();
    expect(h.requireSectionApi).toHaveBeenCalledWith('admin');
  });

  it('POST returns the denial response when the gate denies', async () => {
    const denial = new Response('forbidden', { status: 403 });
    h.requireSectionApi.mockResolvedValueOnce(denial as any);
    const res = await post({ section: 'general', values: { org_name: 'x' } });
    expect(res.status).toBe(403);
  });
});

describe('GET — blanks, no fabrication', () => {
  it('returns an empty settings map when nothing is stored', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.settings).toEqual({});
  });
});

describe('POST — validate, persist, audit', () => {
  it('persists a section and echoes back only the stored value', async () => {
    const res = await post({ section: 'general', values: { org_name: 'Acme Ops', console_url: '' } });
    const body = await res.json();
    expect(body.ok).toBe(true);
    // console_url was blank → cleared/unset → absent from the echo (blank).
    expect(body.settings).toEqual({ org_name: 'Acme Ops' });
    expect(body.settings).not.toHaveProperty('console_url');
  });

  it('audits console.settings.updated with the section + KEYS (never values)', async () => {
    await post({ section: 'general', values: { org_name: 'Acme Ops' } });
    const call = h.appendAudit.mock.calls.find((c) => c[0].action === 'console.settings.updated');
    expect(call).toBeTruthy();
    expect(call![0].detail).toMatchObject({ section: 'general', keys: ['org_name'] });
    // The value must NOT leak into the audit payload.
    expect(JSON.stringify(call![0].detail)).not.toContain('Acme Ops');
  });

  it('rejects an unknown section', async () => {
    const res = await post({ section: 'nope', values: {} });
    expect(res.status).toBe(400);
  });

  it('rejects a key that does not belong to the section', async () => {
    const res = await post({ section: 'general', values: { sla_p1_hours: '4' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not belong/i);
  });

  it('rejects an invalid value and writes nothing', async () => {
    const res = await post({ section: 'general', values: { default_theme: 'neon' } });
    expect(res.status).toBe(400);
    expect(h.rows.size).toBe(0);
  });

  it('does not audit when nothing changed (empty values)', async () => {
    await post({ section: 'general', values: {} });
    const audited = h.appendAudit.mock.calls.filter(
      (c) => c[0].action === 'console.settings.updated',
    );
    expect(audited.length).toBe(0);
  });
});
