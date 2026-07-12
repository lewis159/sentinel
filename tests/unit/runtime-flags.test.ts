import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unit tests for the runtime flag resolver (lib/hermes/runtime-flags.ts). We mock
// server-only + the DB layer so no real Postgres is needed. Proves the core
// contract: the resolver prefers a DB OVERRIDE, else falls back to the ENV
// default, and never throws (DB error → env default).

vi.mock('server-only', () => ({}));

const q1 = vi.fn();
vi.mock('@/lib/db', () => ({
  hasDb: true,
  q: vi.fn(async () => []),
  q1: (...args: any[]) => q1(...args),
}));

import { getRuntimeFlag, getRuntimeFlagState, envFlagDefault, isKnownFlag } from '@/lib/hermes/runtime-flags';

beforeEach(() => {
  q1.mockReset();
  delete process.env.HERMES_BRAIN_ENABLED;
});
afterEach(() => {
  delete process.env.HERMES_BRAIN_ENABLED;
});

describe('flag registry helpers', () => {
  it('recognises known flags and rejects unknown ones', () => {
    expect(isKnownFlag('HERMES_BRAIN_ENABLED')).toBe(true);
    expect(isKnownFlag('HERMES_INNGEST_ENABLED')).toBe(true);
    expect(isKnownFlag('NOT_A_FLAG')).toBe(false);
  });

  it('envFlagDefault reflects the environment', () => {
    expect(envFlagDefault('HERMES_BRAIN_ENABLED')).toBe(false);
    process.env.HERMES_BRAIN_ENABLED = '1';
    expect(envFlagDefault('HERMES_BRAIN_ENABLED')).toBe(true);
  });
});

describe('getRuntimeFlag — DB override first, else env default', () => {
  it('DB override TRUE wins over env default FALSE', async () => {
    q1.mockResolvedValueOnce({ enabled: true });
    expect(await getRuntimeFlag('HERMES_BRAIN_ENABLED')).toBe(true);
  });

  it('DB override FALSE wins over env default TRUE', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    q1.mockResolvedValueOnce({ enabled: false });
    expect(await getRuntimeFlag('HERMES_BRAIN_ENABLED')).toBe(false);
  });

  it('no override row → falls back to the env default', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    q1.mockResolvedValueOnce(null);
    expect(await getRuntimeFlag('HERMES_BRAIN_ENABLED')).toBe(true);
  });

  it('DB error → env default (never throws)', async () => {
    q1.mockRejectedValueOnce(new Error('db down'));
    await expect(getRuntimeFlag('HERMES_BRAIN_ENABLED')).resolves.toBe(false);
  });
});

describe('getRuntimeFlagState — reports source + env default', () => {
  it('source db when an override exists', async () => {
    q1.mockResolvedValueOnce({ enabled: true, updated_at: '2026-07-12T00:00:00Z', updated_by: 'user_1' });
    const s = await getRuntimeFlagState('HERMES_BRAIN_ENABLED');
    expect(s).toMatchObject({ enabled: true, source: 'db', envDefault: false, updatedBy: 'user_1' });
  });

  it('source env when no override', async () => {
    q1.mockResolvedValueOnce(null);
    const s = await getRuntimeFlagState('HERMES_BRAIN_ENABLED');
    expect(s.source).toBe('env');
    expect(s.enabled).toBe(false);
  });
});
