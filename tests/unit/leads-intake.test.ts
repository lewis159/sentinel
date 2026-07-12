import { describe, it, expect, vi, beforeEach } from 'vitest';

// Public lead-intake route — proves the auth + feature-flag gating BEFORE any
// store write, and a happy-path capture. createLead is mocked so no DB is
// touched; auth is the REAL verifySupportIntake driven by a configured token.

const h = vi.hoisted(() => ({
  createLead: vi.fn(async () => ({ ref: 'REQ-0007', assessment: { score: 82, tier: 'hot', reasons: [], signals: {} } })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/leads/store', () => ({ createLead: h.createLead }));

import { POST } from '@/app/api/public/leads/route';
import { __resetRateLimitStore } from '@/lib/rate-limit';

const TOKEN = 'test-support-token';

function req(body: unknown, opts?: { token?: string; contentType?: string }) {
  const headers: Record<string, string> = {
    'content-type': opts?.contentType ?? 'application/json',
  };
  if (opts?.token !== undefined) headers['x-ingest-token'] = opts.token;
  return new Request('http://localhost/api/public/leads', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  __resetRateLimitStore();
  h.createLead.mockClear();
  process.env.OPS_SUPPORT_TOKEN = TOKEN;
  delete process.env.OPS_INGEST_SECRET;
  delete process.env.HERMES_LEADS_ENABLED;
});

describe('POST /api/public/leads gating', () => {
  it('rejects a non-JSON content-type with 415', async () => {
    const res = await POST(req('nope', { token: TOKEN, contentType: 'text/plain' }));
    expect(res.status).toBe(415);
    expect(h.createLead).not.toHaveBeenCalled();
  });

  it('rejects a missing/invalid token with 401', async () => {
    process.env.HERMES_LEADS_ENABLED = '1';
    const res = await POST(req({ message: 'hello' })); // no token header
    expect(res.status).toBe(401);
    expect(h.createLead).not.toHaveBeenCalled();
  });

  it('returns 503 when the leads flag is OFF even with a valid token', async () => {
    const res = await POST(req({ message: 'pricing please' }, { token: TOKEN }));
    expect(res.status).toBe(503);
    expect(h.createLead).not.toHaveBeenCalled();
  });

  it('captures a lead (200) with a valid token AND the flag ON', async () => {
    process.env.HERMES_LEADS_ENABLED = '1';
    const res = await POST(
      req(
        { name: 'Dana', email: 'dana@acme.io', company: 'Acme', message: 'enterprise pricing + demo', source: 'web' },
        { token: TOKEN },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, ref: 'REQ-0007', tier: 'hot', score: 82 });
    expect(h.createLead).toHaveBeenCalledTimes(1);
    expect(h.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Acme', email: 'dana@acme.io', message: 'enterprise pricing + demo' }),
    );
  });

  it('rejects an empty message with 400', async () => {
    process.env.HERMES_LEADS_ENABLED = '1';
    const res = await POST(req({ message: '' }, { token: TOKEN }));
    expect(res.status).toBe(400);
    expect(h.createLead).not.toHaveBeenCalled();
  });
});
