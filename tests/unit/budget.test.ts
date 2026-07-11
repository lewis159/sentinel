import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Budget caps (lib/hermes/budget.ts). pg-mock style: hasDb true, q1 returns the
// resolved cap then the windowed spend sum; q captures ledger inserts.
// checkBudget calls q1 twice (resolveBudget, then the spend sum), so q1Returns
// is queued in that order.
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const q1Returns: any[] = [];
  const q1 = vi.fn(async (_text: string, _params?: any[]) =>
    q1Returns.length ? q1Returns.shift() : null,
  );
  const q = vi.fn(async () => []);
  return { state, q1Returns, q1, q };
});
const { q1Returns, q1, q } = H;

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
}));

import { checkBudget, recordSpend } from '@/lib/hermes/budget';

beforeEach(() => {
  H.state.dbPresent = true;
  q1Returns.length = 0;
  q1.mockClear();
  q.mockClear();
});

describe('checkBudget cap enforcement', () => {
  it('blocks when spent + est would exceed the cap', async () => {
    q1Returns.push({ persona: 'billing', tool: '*', scope: 'global', cap_minor: 1000, window_seconds: 86400 });
    q1Returns.push({ spent: 900 });
    const d = await checkBudget('billing', 'refund', 200);
    expect(d.allowed).toBe(false);
    expect(d.capMinor).toBe(1000);
    expect(d.spentMinor).toBe(900);
    expect(d.remainingMinor).toBe(100);
    expect(d.uncapped).toBe(false);
    expect(d.reason).toMatch(/exceeded/i);
  });

  it('allows when spent + est stays within the cap', async () => {
    q1Returns.push({ persona: 'billing', tool: '*', scope: 'global', cap_minor: 1000, window_seconds: 86400 });
    q1Returns.push({ spent: 100 });
    const d = await checkBudget('billing', 'refund', 200);
    expect(d.allowed).toBe(true);
    expect(d.spentMinor).toBe(100);
    expect(d.remainingMinor).toBe(900);
  });

  it('allows exactly at the cap boundary (spent + est == cap)', async () => {
    q1Returns.push({ persona: 'pa', tool: '*', scope: 'global', cap_minor: 500, window_seconds: 86400 });
    q1Returns.push({ spent: 300 });
    const d = await checkBudget('pa', 'updateTicket', 200);
    expect(d.allowed).toBe(true);
    expect(d.remainingMinor).toBe(200);
  });

  it('no cap configured → allowed + uncapped', async () => {
    q1Returns.push(null); // resolveBudget finds nothing
    const d = await checkBudget('unknown', 'refund', 999999);
    expect(d.allowed).toBe(true);
    expect(d.uncapped).toBe(true);
    expect(d.capMinor).toBeNull();
  });

  it('no DB → allowed + uncapped, no query', async () => {
    H.state.dbPresent = false;
    const d = await checkBudget('billing', 'refund', 200);
    expect(d.allowed).toBe(true);
    expect(d.uncapped).toBe(true);
    expect(q1).not.toHaveBeenCalled();
  });

  it('sums all tools for a persona-wide (*) cap', async () => {
    q1Returns.push({ persona: 'pa', tool: '*', scope: 'global', cap_minor: 5000, window_seconds: 86400 });
    q1Returns.push({ spent: 4000 });
    await checkBudget('pa', 'someTool', 500);
    // The spend-sum SQL must NOT filter by tool for a '*' cap.
    const spendCall = q1.mock.calls[1] as [string, any[]];
    expect(spendCall[0]).not.toMatch(/and tool = /i);
    expect(spendCall[1]).toEqual(['pa', 'global', 86400]);
  });
});

describe('recordSpend', () => {
  it('appends a ledger row with the concrete tool + amount', async () => {
    await recordSpend('billing', 'refund', 1500, { proposalId: 'prop-9', note: 'auto-refund' });
    const [sql, params] = q.mock.calls[0] as [string, any[]];
    expect(sql).toMatch(/insert into ops\.hermes_budget_ledger/i);
    expect(params).toEqual(['billing', 'refund', 'global', 1500, 'prop-9', 'auto-refund']);
  });

  it('no DB → no-op', async () => {
    H.state.dbPresent = false;
    await recordSpend('billing', 'refund', 1500);
    expect(q).not.toHaveBeenCalled();
  });
});
