import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Governance console data layer (lib/hermes/governance.ts) + the autonomy
// persistence path it shares (lib/hermes/brain/autonomy.ts saveAutonomyConfig).
// Both are server-only + DB-backed, so we stub 'server-only' and '@/lib/db':
//   - hasDb toggled per-test
//   - q captures the upsert SQL + params (returns [] like a DDL/insert)
//   - q1 unused here (returns null)
// This lets us assert the budget upsert's VALIDATION + MINOR-UNIT CONVERSION and
// that an autonomy dial edit PERSISTS, with no live database.
// ---------------------------------------------------------------------------
vi.mock('server-only', () => ({}));

const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const q = vi.fn(async (_text: string, _params?: any[]) => [] as any[]);
  const q1 = vi.fn(async () => null);
  return { state, q, q1 };
});

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
}));

import { toMinorUnits, upsertBudgetCap } from '@/lib/hermes/governance';
import { saveAutonomyConfig } from '@/lib/hermes/brain/autonomy';

beforeEach(() => {
  H.state.dbPresent = true;
  H.q.mockClear();
  H.q1.mockClear();
});

describe('toMinorUnits — major → minor conversion', () => {
  it('converts whole pounds to pennies', () => {
    expect(toMinorUnits(15)).toBe(1500);
  });
  it('rounds fractional pounds to the nearest penny', () => {
    expect(toMinorUnits(12.345)).toBe(1235); // 1234.5 → 1235
    expect(toMinorUnits(0.1)).toBe(10);
  });
  it('clamps negatives to 0 and handles non-finite input', () => {
    expect(toMinorUnits(-5)).toBe(0);
    expect(toMinorUnits(NaN)).toBe(0);
  });
});

describe('upsertBudgetCap — validation + minor-unit conversion + persistence', () => {
  it('rejects an empty persona (no query)', async () => {
    const r = await upsertBudgetCap({ persona: '', capMajor: 10, windowSeconds: 86400 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/persona/i);
    expect(H.q).not.toHaveBeenCalled();
  });

  it('rejects a persona not in the roster', async () => {
    const r = await upsertBudgetCap({ persona: 'nobody', capMajor: 10, windowSeconds: 86400 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown persona/i);
    expect(H.q).not.toHaveBeenCalled();
  });

  it('rejects a negative cap', async () => {
    const r = await upsertBudgetCap({ persona: 'billing', capMajor: -1, windowSeconds: 86400 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non-negative/i);
    expect(H.q).not.toHaveBeenCalled();
  });

  it('rejects a non-positive window', async () => {
    const r = await upsertBudgetCap({ persona: 'billing', capMajor: 10, windowSeconds: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/window/i);
    expect(H.q).not.toHaveBeenCalled();
  });

  it('upserts a valid cap with £ → pennies conversion and defaults', async () => {
    const r = await upsertBudgetCap({ persona: 'billing', capMajor: 15, windowSeconds: 86400, by: 'ben' });
    expect(r.ok).toBe(true);
    expect(r.cap).toEqual({ persona: 'billing', tool: '*', scope: 'global', capMinor: 1500, windowSeconds: 86400 });

    // The upsert SQL + params: cap stored in MINOR units; tool/scope defaulted.
    const [sql, params] = H.q.mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/insert into ops\.hermes_budgets/i);
    expect(sql).toMatch(/on conflict \(persona, tool, scope\)/i);
    expect(params).toEqual(['billing', '*', 'global', 1500, 86400, 'ben']);
  });

  it('honours an explicit tool + weekly window and converts fractional £', async () => {
    const r = await upsertBudgetCap({
      persona: 'support',
      tool: 'sendEmail',
      capMajor: 2.5,
      windowSeconds: 604800,
    });
    expect(r.ok).toBe(true);
    const [, params] = H.q.mock.calls[0] as [string, any[]];
    expect(params[0]).toBe('support');
    expect(params[1]).toBe('sendEmail');
    expect(params[3]).toBe(250); // £2.50 → 250 pennies
    expect(params[4]).toBe(604800);
  });

  it('no DB → ok:false, never queries', async () => {
    H.state.dbPresent = false;
    const r = await upsertBudgetCap({ persona: 'billing', capMajor: 10, windowSeconds: 86400 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no database/i);
    expect(H.q).not.toHaveBeenCalled();
  });
});

describe('saveAutonomyConfig — a dial edit persists', () => {
  it('upserts the (persona, tool, mode) into hermes.autonomy_config', async () => {
    const r = await saveAutonomyConfig({
      tools: [{ persona: 'billing', tool: 'refundCharge', mode: 'auto' }],
      by: 'ben',
    });
    expect(r.ok).toBe(true);

    // Find the autonomy_config upsert among the DDL/ensure calls.
    const upsert = H.q.mock.calls.find(([sql]) =>
      /insert into hermes\.autonomy_config/i.test(String(sql)),
    ) as [string, any[]] | undefined;
    expect(upsert).toBeDefined();
    expect(upsert![0]).toMatch(/on conflict \(persona, tool\)/i);
    expect(upsert![1]).toEqual(['billing', 'refundCharge', 'auto', 'ben']);
  });

  it('ignores an invalid mode (no autonomy_config upsert)', async () => {
    const r = await saveAutonomyConfig({
      tools: [{ persona: 'billing', tool: 'refundCharge', mode: 'nonsense' as any }],
      by: 'ben',
    });
    expect(r.ok).toBe(true);
    const upsert = H.q.mock.calls.find(([sql]) =>
      /insert into hermes\.autonomy_config/i.test(String(sql)),
    );
    expect(upsert).toBeUndefined();
  });

  it('no DB → ok:false', async () => {
    H.state.dbPresent = false;
    const r = await saveAutonomyConfig({
      tools: [{ persona: 'billing', tool: 'refundCharge', mode: 'auto' }],
    });
    expect(r.ok).toBe(false);
  });
});
