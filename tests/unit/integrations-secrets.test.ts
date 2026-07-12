import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unit tests for the Infisical WRITE + METADATA helpers (lib/secrets.ts). We set
// the bootstrap env via vi.hoisted (runs before the static import so the module's
// top-level consts pick them up) and mock global fetch so NO network is hit.
// Proves:
//   • setSecret logs in, then PATCHes the raw-secret endpoint with the right
//     URL / Bearer auth / body (workspaceId + environment + secretValue).
//   • setSecret NEVER returns the value; the value is NEVER logged.
//   • getSecretMeta returns presence + updatedAt ONLY — never the secretValue.

vi.mock('server-only', () => ({}));

vi.hoisted(() => {
  process.env.INFISICAL_SITE_URL = 'https://secrets.example.test';
  process.env.INFISICAL_CLIENT_ID = 'cid-123';
  process.env.INFISICAL_CLIENT_SECRET = 'csecret-xyz';
  process.env.INFISICAL_PROJECT_ID = 'proj-abc';
  process.env.INFISICAL_ENVIRONMENT = 'prod';
});

import { setSecret, getSecretMeta, hasInfisical } from '@/lib/secrets';

// Route fetch by URL: the login endpoint returns an access token; everything else
// returns the caller-provided response. Records all calls for assertions.
function routeFetch(secretResponse: { ok?: boolean; status?: number; body?: any }) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    if (url.includes('/auth/universal-auth/login')) {
      return { ok: true, status: 200, json: async () => ({ accessToken: 'tok-999', expiresIn: 600 }) };
    }
    return {
      ok: secretResponse.ok ?? true,
      status: secretResponse.status ?? 200,
      json: async () => secretResponse.body ?? {},
    };
  });
  vi.stubGlobal('fetch', fn as any);
  return { fn, calls };
}

beforeEach(() => {
  // Bust the module's internal token/secret caches between tests by clearing time.
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hasInfisical', () => {
  it('is true when all bootstrap env vars are present', () => {
    expect(hasInfisical()).toBe(true);
  });
});

describe('setSecret (Infisical write)', () => {
  it('PATCHes the raw-secret endpoint with Bearer auth and the right body', async () => {
    const { calls } = routeFetch({ ok: true, status: 200, body: { secret: {} } });
    const res = await setSecret('OPENROUTER_API_KEY', 'sk-or-secret-value');

    expect(res.ok).toBe(true);
    // The write call is the one to the raw-secret endpoint (not the login).
    const write = calls.find((c) => c.url.includes('/api/v3/secrets/raw/OPENROUTER_API_KEY'));
    expect(write).toBeTruthy();
    expect(write!.init.method).toBe('PATCH');
    expect(write!.init.headers.Authorization).toBe('Bearer tok-999');
    const body = JSON.parse(write!.init.body);
    expect(body.workspaceId).toBe('proj-abc');
    expect(body.environment).toBe('prod');
    expect(body.secretPath).toBe('/');
    expect(body.secretValue).toBe('sk-or-secret-value');
  });

  it('never returns the value and never logs it', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    routeFetch({ ok: true, status: 200, body: { secret: {} } });

    const res = await setSecret('STRIPE_SECRET_KEY', 'sk_live_SUPER_SECRET');
    expect(JSON.stringify(res)).not.toContain('sk_live_SUPER_SECRET');
    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('sk_live_SUPER_SECRET');
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('falls back to POST (create) when PATCH returns 404', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fn = vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      if (url.includes('/auth/universal-auth/login')) {
        return { ok: true, status: 200, json: async () => ({ accessToken: 'tok-1', expiresIn: 600 }) };
      }
      if (init.method === 'PATCH') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ secret: {} }) };
    });
    vi.stubGlobal('fetch', fn as any);

    const res = await setSecret('RESEND_API', 're_new');
    expect(res.ok).toBe(true);
    const methods = calls.filter((c) => c.url.includes('/secrets/raw/RESEND_API')).map((c) => c.init.method);
    expect(methods).toContain('PATCH');
    expect(methods).toContain('POST');
  });
});

describe('getSecretMeta (metadata read)', () => {
  it('returns presence + updatedAt ONLY — never the value', async () => {
    routeFetch({
      ok: true,
      status: 200,
      body: { secret: { secretValue: 'THE-REAL-KEY', updatedAt: '2026-07-12T09:00:00Z' } },
    });
    const meta = await getSecretMeta('HERMES_GITHUB_TOKEN');
    expect(meta.exists).toBe(true);
    expect(meta.updatedAt).toBe('2026-07-12T09:00:00Z');
    expect(JSON.stringify(meta)).not.toContain('THE-REAL-KEY');
    expect((meta as any).secretValue).toBeUndefined();
    expect((meta as any).value).toBeUndefined();
  });

  it('a 404 → { exists:false }', async () => {
    routeFetch({ ok: false, status: 404, body: {} });
    const meta = await getSecretMeta('DOES_NOT_EXIST');
    expect(meta.exists).toBe(false);
  });

  it('a present-but-empty value counts as not configured', async () => {
    routeFetch({ ok: true, status: 200, body: { secret: { secretValue: '', updatedAt: 'x' } } });
    const meta = await getSecretMeta('BLANKED_KEY');
    expect(meta.exists).toBe(false);
  });
});
