import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hermes provider config key persistence (lib/hermes/config.ts).
//
// Proves, WITHOUT Infisical and WITHOUT a real Postgres:
//   • setHermesConfig({ apiKey }) persists the key to ops.app_config (DB), so the
//     UI "Save key" works with NO Infisical wired,
//   • getHermesRuntimeConfig then RESOLVES that key from the DB and reports
//     source 'db' (Infisical → env → DB precedence, DB branch),
//   • getPublicHermesConfig masks it (never returns the raw key) and reports 'db',
//   • setHermesConfig({ clearKey }) deletes the DB row → resolves back to 'none'.
//
// The DB is an honest in-memory row map; secrets are stubbed as "no Infisical".
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  const q = vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.toLowerCase();
    if (s.includes('create table')) return [];
    if (s.startsWith('insert into ops.app_config')) {
      store.set(params[0], params[1]);
      return [];
    }
    if (s.startsWith('delete from ops.app_config')) {
      store.delete(params[0]);
      return [];
    }
    if (s.includes('select key, value from ops.app_config')) {
      const keys: string[] = params[0] ?? [];
      return keys
        .filter((k) => store.has(k))
        .map((k) => ({ key: k, value: store.get(k) }));
    }
    return [];
  });
  return { store, q };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  hasDb: true,
  q: h.q,
  q1: vi.fn(async () => null),
}));
// No Infisical in this environment → the DB is the durable store.
vi.mock('@/lib/secrets', () => ({
  hasInfisical: () => false,
  getSecret: vi.fn(async () => undefined),
  setSecret: vi.fn(async () => ({ ok: true })),
}));

import {
  setHermesConfig,
  getHermesRuntimeConfig,
  getPublicHermesConfig,
} from '@/lib/hermes/config';

beforeEach(() => {
  h.store.clear();
  h.q.mockClear();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HERMES_MODEL;
});

describe('setHermesConfig — DB-persisted API key (no Infisical)', () => {
  it('persists the key to ops.app_config and resolves it from the DB (source db)', async () => {
    const res = await setHermesConfig({ apiKey: 'sk-or-v1-TESTKEY1234' });
    expect(res.ok).toBe(true);
    // Persisted under the KEY_APIKEY row.
    expect(h.store.get('hermes.openrouter_key')).toBe('sk-or-v1-TESTKEY1234');

    const runtime = await getHermesRuntimeConfig();
    expect(runtime.hasKey).toBe(true);
    expect(runtime.apiKey).toBe('sk-or-v1-TESTKEY1234');
    expect(runtime.source).toBe('db');
  });

  it('public config masks the key and reports source db', async () => {
    await setHermesConfig({ apiKey: 'sk-or-v1-TESTKEY1234' });
    const pub = await getPublicHermesConfig();
    expect(pub.hasKey).toBe(true);
    expect(pub.source).toBe('db');
    expect(pub.keyHint).toBe('••••1234');
    // The raw key must NOT be present on the public surface.
    expect(JSON.stringify(pub)).not.toContain('sk-or-v1-TESTKEY1234');
  });

  it('env var still wins over the DB key (precedence)', async () => {
    await setHermesConfig({ apiKey: 'sk-or-v1-DBKEY' });
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-ENVKEY';
    const runtime = await getHermesRuntimeConfig();
    expect(runtime.apiKey).toBe('sk-or-v1-ENVKEY');
    expect(runtime.source).toBe('env');
  });

  it('clearKey deletes the DB row → resolves back to none', async () => {
    await setHermesConfig({ apiKey: 'sk-or-v1-TOCLEAR' });
    expect(h.store.has('hermes.openrouter_key')).toBe(true);

    const res = await setHermesConfig({ clearKey: true });
    expect(res.ok).toBe(true);
    expect(h.store.has('hermes.openrouter_key')).toBe(false);

    const runtime = await getHermesRuntimeConfig();
    expect(runtime.hasKey).toBe(false);
    expect(runtime.source).toBe('none');
  });

  it('persists the model alongside the key', async () => {
    await setHermesConfig({ apiKey: 'sk-or-v1-K', model: 'anthropic/claude-3.7-sonnet' });
    expect(h.store.get('hermes.model')).toBe('anthropic/claude-3.7-sonnet');
    const runtime = await getHermesRuntimeConfig();
    expect(runtime.model).toBe('anthropic/claude-3.7-sonnet');
  });
});
