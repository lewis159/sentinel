import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unit tests for the Integrations service layer (lib/integrations/service.ts).
// The real registry is used; secrets, runtime-flags and audit are mocked so no
// network / DB is touched. Proves the SECURITY CONTRACT:
//   • buildIntegrationsPayload returns presence + updatedAt ONLY — never a value.
//   • writeIntegrationKey writes via setSecret, audits, and never echoes the key.
//   • runIntegrationTest maps ok/fail and never returns the key.
//   • setIntegrationFlag writes the override and audits.

vi.mock('server-only', () => ({}));

const getSecret = vi.fn(async () => undefined as string | undefined);
const getSecretMeta = vi.fn(async () => ({ exists: false }) as { exists: boolean; updatedAt?: string });
const setSecret = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
const hasInfisical = vi.fn(() => true);
vi.mock('@/lib/secrets', () => ({
  getSecret: (...a: any[]) => getSecret(...a),
  getSecretMeta: (...a: any[]) => getSecretMeta(...a),
  setSecret: (...a: any[]) => setSecret(...a),
  hasInfisical: (...a: any[]) => hasInfisical(...a),
}));

const getRuntimeFlagState = vi.fn(async (flag: string) => ({
  flag,
  enabled: false,
  envDefault: false,
  source: 'env' as const,
}));
const setRuntimeFlag = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
vi.mock('@/lib/hermes/runtime-flags', () => ({
  getRuntimeFlagState: (...a: any[]) => getRuntimeFlagState(...a),
  setRuntimeFlag: (...a: any[]) => setRuntimeFlag(...a),
}));

const appendAudit = vi.fn(async (entry: any) => ({ seq: 1, id: 'a', ...entry }));
vi.mock('@/lib/hermes/audit', () => ({
  appendAudit: (...a: any[]) => appendAudit(...a),
}));

import {
  buildIntegrationsPayload,
  writeIntegrationKey,
  runIntegrationTest,
  setIntegrationFlag,
} from '@/lib/integrations/service';

beforeEach(() => {
  vi.clearAllMocks();
  getSecret.mockResolvedValue(undefined);
  getSecretMeta.mockResolvedValue({ exists: false });
  setSecret.mockResolvedValue({ ok: true });
  hasInfisical.mockReturnValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildIntegrationsPayload', () => {
  it('reads metadata via getSecretMeta (never getSecret) and returns NO value', async () => {
    getSecretMeta.mockResolvedValue({ exists: true, updatedAt: '2026-07-12T08:00:00Z' });
    const payload = await buildIntegrationsPayload();

    expect(getSecret).not.toHaveBeenCalled();
    expect(payload.infisicalConfigured).toBe(true);
    expect(payload.integrations.length).toBeGreaterThan(0);

    const flat = JSON.stringify(payload);
    // No secretValue-style field anywhere in the serialised payload.
    expect(flat).not.toContain('secretValue');

    for (const it of payload.integrations) {
      expect(it).not.toHaveProperty('value');
      for (const s of it.secrets) {
        expect(Object.keys(s).sort()).toEqual(['key', 'present', 'updatedAt']);
        expect(typeof s.present).toBe('boolean');
      }
      expect(it.configured).toBe(true);
    }
  });

  it('configured is false when a mapped secret is missing', async () => {
    getSecretMeta.mockResolvedValue({ exists: false });
    const payload = await buildIntegrationsPayload();
    expect(payload.integrations.every((i) => i.configured === false)).toBe(true);
  });
});

describe('writeIntegrationKey', () => {
  it('writes via setSecret, audits, and never echoes the key', async () => {
    const res = await writeIntegrationKey('openrouter', 'sk-or-SECRET', 'user_42');
    expect(res.ok).toBe(true);
    expect(setSecret).toHaveBeenCalledWith('OPENROUTER_API_KEY', 'sk-or-SECRET');

    expect(appendAudit).toHaveBeenCalledTimes(1);
    const entry = appendAudit.mock.calls[0][0];
    expect(entry.action).toBe('integration.key.set');
    expect(entry.actor).toBe('user_42');
    // The audit record must NOT contain the key value.
    expect(JSON.stringify(entry)).not.toContain('sk-or-SECRET');
    // The response must NOT contain the value.
    expect(JSON.stringify(res)).not.toContain('sk-or-SECRET');
  });

  it('unknown integration → error, no write', async () => {
    const res = await writeIntegrationKey('nope', 'x');
    expect(res.ok).toBe(false);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('propagates a setSecret failure and does NOT audit', async () => {
    setSecret.mockResolvedValue({ ok: false, error: 'Infisical not configured' });
    const res = await writeIntegrationKey('stripe', 'sk_live_x');
    expect(res.ok).toBe(false);
    expect(appendAudit).not.toHaveBeenCalled();
  });
});

describe('runIntegrationTest', () => {
  it('not_configured when there is no stored key (no provider call)', async () => {
    getSecret.mockResolvedValue(undefined);
    const res = await runIntegrationTest('openrouter');
    expect(res.status).toBe('not_configured');
    expect(res.ok).toBe(false);
  });

  it('maps a live 200 → ok and never returns the key', async () => {
    getSecret.mockResolvedValue('sk-or-STORED');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { label: 'p' } }) })) as any,
    );
    const res = await runIntegrationTest('openrouter', 'user_9');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('ok');
    expect(JSON.stringify(res)).not.toContain('sk-or-STORED');
    // The test result is audited.
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.test' }),
    );
  });

  it('maps a live 401 → fail', async () => {
    getSecret.mockResolvedValue('sk-or-STORED');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as any,
    );
    const res = await runIntegrationTest('openrouter');
    expect(res.ok).toBe(false);
    expect(res.status).toBe('fail');
  });
});

describe('setIntegrationFlag', () => {
  it('writes the override and audits', async () => {
    const res = await setIntegrationFlag('openrouter', true, 'user_7');
    expect(res.ok).toBe(true);
    expect(setRuntimeFlag).toHaveBeenCalledWith('HERMES_BRAIN_ENABLED', true, 'user_7');
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.flag.set' }),
    );
  });

  it('integration with no flag → error', async () => {
    const res = await setIntegrationFlag('stripe', true);
    expect(res.ok).toBe(false);
    expect(setRuntimeFlag).not.toHaveBeenCalled();
  });
});
