import { describe, it, expect, vi, afterEach } from 'vitest';

// The registry is a PURE module (no server-only, no secret access), so we can
// import it directly and exercise each integration's live test() with a mocked
// global fetch. Proves:
//   • registry shape — required fields, unique ids, valid flags.
//   • test() maps a 2xx → ok and a 401/network error → fail.
//   • test() NEVER puts the key into the returned detail.
import { INTEGRATIONS, getIntegration, isTestable } from '@/lib/integrations/registry';

function mockFetch(response: { ok?: boolean; status?: number; body?: any }) {
  const fn = vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  }));
  vi.stubGlobal('fetch', fn as any);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const KNOWN_FLAGS = new Set(['HERMES_BRAIN_ENABLED', 'HERMES_INNGEST_ENABLED']);

describe('integration registry shape', () => {
  it('every entry has the required fields and a unique id', () => {
    const ids = new Set<string>();
    for (const def of INTEGRATIONS) {
      expect(typeof def.id).toBe('string');
      expect(def.id.length).toBeGreaterThan(0);
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      expect(typeof def.label).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(Array.isArray(def.secretKeys)).toBe(true);
      expect(def.secretKeys.length).toBeGreaterThan(0);
      // primaryKey must be one of the mapped secret keys.
      expect(def.secretKeys).toContain(def.primaryKey);
      if (def.flag) expect(KNOWN_FLAGS.has(def.flag)).toBe(true);
      if (def.test) expect(typeof def.test).toBe('function');
    }
  });

  it('covers the required providers', () => {
    for (const id of ['openrouter', 'stripe', 'resend', 'github', 'discord', 'inngest']) {
      expect(getIntegration(id)).toBeTruthy();
    }
  });

  it('OpenRouter drives HERMES_BRAIN_ENABLED; Inngest is not testable', () => {
    expect(getIntegration('openrouter')!.flag).toBe('HERMES_BRAIN_ENABLED');
    expect(isTestable(getIntegration('inngest')!)).toBe(false);
    expect(getIntegration('inngest')!.flag).toBe('HERMES_INNGEST_ENABLED');
  });
});

describe('integration test() ok/fail mapping', () => {
  it('OpenRouter: 200 → ok, and the key is never echoed in the detail', async () => {
    mockFetch({ ok: true, status: 200, body: { data: { label: 'prod', limit: null } } });
    const res = await getIntegration('openrouter')!.test!('sk-or-secret-123');
    expect(res.ok).toBe(true);
    expect(res.detail).not.toContain('sk-or-secret-123');
  });

  it('OpenRouter: 401 → fail with a status detail (no key)', async () => {
    mockFetch({ ok: false, status: 401, body: {} });
    const res = await getIntegration('openrouter')!.test!('sk-or-secret-123');
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('401');
    expect(res.detail).not.toContain('sk-or-secret-123');
  });

  it('Stripe: 200 → ok', async () => {
    mockFetch({ ok: true, status: 200, body: { livemode: false, available: [{ currency: 'gbp' }] } });
    const res = await getIntegration('stripe')!.test!('sk_test_x');
    expect(res.ok).toBe(true);
    expect(res.detail).not.toContain('sk_test_x');
  });

  it('GitHub: 200 → ok with login', async () => {
    mockFetch({ ok: true, status: 200, body: { login: 'octo' } });
    const res = await getIntegration('github')!.test!('ghp_secret');
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('octo');
    expect(res.detail).not.toContain('ghp_secret');
  });

  it('Discord: 200 → ok; uses Bot auth header', async () => {
    const fetchFn = mockFetch({ ok: true, status: 200, body: { username: 'hermes' } });
    const res = await getIntegration('discord')!.test!('discord-secret');
    expect(res.ok).toBe(true);
    const [, init] = fetchFn.mock.calls[0] as [string, any];
    expect(init.headers.Authorization).toBe('Bot discord-secret');
  });

  it('network throw → fail (never throws out)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }) as any);
    const res = await getIntegration('resend')!.test!('re_secret');
    expect(res.ok).toBe(false);
    expect(res.detail).not.toContain('re_secret');
  });
});
