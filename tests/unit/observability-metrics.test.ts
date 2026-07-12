import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Agent Observability metrics (lib/observability/metrics.ts). pg-mock style: a
// hoisted state holds `dbPresent` + FIFO return queues for q (multi-row) and q1
// (single-row). Each metric function issues its queries in a known order, so we
// queue the raw pg rows in that order and assert the aggregation/derived math.
//
// verifyChain (lib/hermes/audit) is mocked to a fixed chain result so the audit
// metric is deterministic without a DB.
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const qReturns: any[][] = [];
  const q1Returns: any[] = [];
  const q = vi.fn(async (_t: string, _p?: any[]) => (qReturns.length ? qReturns.shift() : []));
  const q1 = vi.fn(async (_t: string, _p?: any[]) => (q1Returns.length ? q1Returns.shift() : null));
  const chain = { value: { ok: true, count: 0, brokenAtSeq: null } as any };
  return { state, qReturns, q1Returns, q, q1, chain };
});

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
}));

vi.mock('@/lib/hermes/audit', () => ({
  verifyChain: vi.fn(async () => H.chain.value),
}));

import {
  approvalRatePct,
  utilisationPct,
  num,
  getProposalMetrics,
  getExecutionMetrics,
  getBudgetMetrics,
  getAuditMetrics,
  getObservability,
} from '@/lib/observability/metrics';

beforeEach(() => {
  H.state.dbPresent = true;
  H.qReturns.length = 0;
  H.q1Returns.length = 0;
  H.q.mockClear();
  H.q1.mockClear();
  H.chain.value = { ok: true, count: 0, brokenAtSeq: null };
});

// --------------------------------------------------------------------------
describe('pure math helpers', () => {
  it('approvalRatePct = sent / (sent + dismissed), rounded, pending excluded', () => {
    expect(approvalRatePct(3, 1)).toBe(75); // 3 of 4 decided
    expect(approvalRatePct(1, 2)).toBe(33); // 33.3 → 33
    expect(approvalRatePct(0, 0)).toBe(0);  // no decisions → 0, no divide-by-zero
    expect(approvalRatePct(5, 0)).toBe(100);
  });

  it('utilisationPct = spent / cap, rounded; uncapped → 0', () => {
    expect(utilisationPct(50, 100)).toBe(50);
    expect(utilisationPct(900, 1000)).toBe(90);
    expect(utilisationPct(1200, 1000)).toBe(120); // over-cap surfaces >100
    expect(utilisationPct(10, 0)).toBe(0);         // no cap → 0, never NaN/Infinity
  });

  it('num coerces bigint strings and null safely', () => {
    expect(num('900')).toBe(900); // pg bigint arrives as a string
    expect(num(42)).toBe(42);
    expect(num(null)).toBe(0);
    expect(num('nope')).toBe(0);
  });
});

// --------------------------------------------------------------------------
describe('getProposalMetrics', () => {
  it('aggregates status + windows and derives approval rate', async () => {
    // Query 1 (q1): the totals roll-up.
    H.q1Returns.push({
      total: 10, pending: 4, sent: 3, dismissed: 3,
      created_24h: 2, created_7d: 6, created_30d: 10,
    });
    // Query 2 (q): per-agent breakdown.
    H.qReturns.push([
      { agent: 'support', total: 6, pending: 2, sent: 2, dismissed: 2 },
      { agent: 'billing', total: 4, pending: 2, sent: 1, dismissed: 1 },
    ]);

    const m = await getProposalMetrics();
    expect(m.live).toBe(true);
    expect(m.total).toBe(10);
    expect(m.pending).toBe(4);
    expect(m.created24h).toBe(2);
    expect(m.created7d).toBe(6);
    expect(m.created30d).toBe(10);
    // approval rate = sent / (sent + dismissed) = 3 / 6 = 50
    expect(m.approvalRatePct).toBe(50);
    expect(m.byAgent).toHaveLength(2);
    expect(m.byAgent[0].agent).toBe('support');
  });

  it('no DB → zeroed structure, live:false, does not throw', async () => {
    H.state.dbPresent = false;
    const m = await getProposalMetrics();
    expect(m.live).toBe(false);
    expect(m.total).toBe(0);
    expect(m.approvalRatePct).toBe(0);
    expect(m.byAgent).toEqual([]);
    expect(H.q).not.toHaveBeenCalled();
  });

  it('query error → zeroed live:false (never throws)', async () => {
    H.q1.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const m = await getProposalMetrics();
    expect(m.live).toBe(false);
    expect(m.note).toBe('boom');
    expect(m.total).toBe(0);
  });
});

// --------------------------------------------------------------------------
describe('getExecutionMetrics', () => {
  it('sums by-tool rows and reports exactly-once integrity (0 dupes)', async () => {
    H.qReturns.push([
      { tool: 'refund', runs: 5, succeeded: 4, failed: 1, claimed: 0 },
      { tool: 'reply', runs: 3, succeeded: 3, failed: 0, claimed: 0 },
    ]);
    H.q1Returns.push({ dupes: 0 });

    const m = await getExecutionMetrics();
    expect(m.live).toBe(true);
    expect(m.total).toBe(8);
    expect(m.succeeded).toBe(7);
    expect(m.failed).toBe(1);
    expect(m.idempotencyDupes).toBe(0);
    expect(m.exactlyOnceOk).toBe(true);
    expect(m.byTool).toHaveLength(2);
  });

  it('non-zero idempotency dupes flip exactlyOnceOk false', async () => {
    H.qReturns.push([{ tool: 'refund', runs: 2, succeeded: 1, failed: 0, claimed: 1 }]);
    H.q1Returns.push({ dupes: 1 });

    const m = await getExecutionMetrics();
    expect(m.idempotencyDupes).toBe(1);
    expect(m.exactlyOnceOk).toBe(false);
  });

  it('no DB → zeroed, exactlyOnceOk defaults true, live:false', async () => {
    H.state.dbPresent = false;
    const m = await getExecutionMetrics();
    expect(m.live).toBe(false);
    expect(m.total).toBe(0);
    expect(m.exactlyOnceOk).toBe(true);
    expect(m.byTool).toEqual([]);
  });
});

// --------------------------------------------------------------------------
describe('getBudgetMetrics', () => {
  it('computes per-cap + overall utilisation from ledger sums (bigint strings)', async () => {
    // caps join (q) — spent_minor arrives as a bigint string from pg.
    H.qReturns.push([
      { persona: 'pa', tool: '*', scope: 'global', cap_minor: '5000', window_seconds: 86400, spent_minor: '2500' },
      { persona: 'billing', tool: '*', scope: 'global', cap_minor: '1500', window_seconds: 86400, spent_minor: '1500' },
    ]);
    // recent ledger rows (q)
    H.qReturns.push([
      { persona: 'billing', tool: 'refund', amount_minor: '900', note: 'dup charge', created_at: '2026-07-12T00:00:00Z' },
    ]);

    const m = await getBudgetMetrics();
    expect(m.live).toBe(true);
    expect(m.caps[0].utilisationPct).toBe(50);   // 2500/5000
    expect(m.caps[1].utilisationPct).toBe(100);  // 1500/1500
    expect(m.totalCapMinor).toBe(6500);
    expect(m.totalSpentMinor).toBe(4000);
    // overall = 4000/6500 = 61.5 → 62
    expect(m.overallUtilisationPct).toBe(62);
    expect(m.recent[0].amountMinor).toBe(900);
  });

  it('no DB → empty caps, 0 utilisation, live:false', async () => {
    H.state.dbPresent = false;
    const m = await getBudgetMetrics();
    expect(m.live).toBe(false);
    expect(m.caps).toEqual([]);
    expect(m.overallUtilisationPct).toBe(0);
  });
});

// --------------------------------------------------------------------------
describe('getAuditMetrics', () => {
  it('aggregates by action + surfaces chain status and feed', async () => {
    H.chain.value = { ok: true, count: 12, brokenAtSeq: null };
    // byAction (q)
    H.qReturns.push([
      { action: 'proposal.created', total: 8, last_24h: 3 },
      { action: 'proposal.approved', total: 4, last_24h: 1 },
    ]);
    // feed (q)
    H.qReturns.push([
      { ts: '2026-07-12T10:00:00Z', actor: 'ben', action: 'proposal.approved', tool: 'refund', summary: 'approved' },
    ]);

    const m = await getAuditMetrics();
    expect(m.live).toBe(true);
    expect(m.total).toBe(12);
    expect(m.last24h).toBe(4);
    expect(m.chain.ok).toBe(true);
    expect(m.chain.count).toBe(12);
    expect(m.feed).toHaveLength(1);
    expect(m.feed[0].actor).toBe('ben');
  });

  it('broken chain is reported (ok:false)', async () => {
    H.chain.value = { ok: false, count: 5, brokenAtSeq: 3, reason: 'row was altered' };
    H.qReturns.push([]); // byAction
    H.qReturns.push([]); // feed
    const m = await getAuditMetrics();
    expect(m.chain.ok).toBe(false);
    expect(m.chain.brokenAtSeq).toBe(3);
  });

  it('no DB → empty, valid empty chain, live:false', async () => {
    H.state.dbPresent = false;
    H.chain.value = { ok: true, count: 0, brokenAtSeq: null };
    const m = await getAuditMetrics();
    expect(m.live).toBe(false);
    expect(m.total).toBe(0);
    expect(m.chain.ok).toBe(true);
    expect(m.feed).toEqual([]);
  });
});

// --------------------------------------------------------------------------
describe('getObservability aggregate', () => {
  it('no DB → all sources zeroed and overall live:false', async () => {
    H.state.dbPresent = false;
    const o = await getObservability();
    expect(o.live).toBe(false);
    expect(o.proposals.live).toBe(false);
    expect(o.executions.live).toBe(false);
    expect(o.budget.live).toBe(false);
    expect(o.audit.live).toBe(false);
  });
});
