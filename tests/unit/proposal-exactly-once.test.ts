import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P3 wiring proof at the actOnProposal (approve) level: approving the SAME
// action proposal twice resumes the graph — and therefore runs the gated
// money/account tool — EXACTLY ONCE. The second approve loses the exec-ledger
// claim and returns the prior result WITHOUT re-executing.
//
// We mock the substrate the way the substrate's own unit tests do: db present,
// resumeThread is a spy (stands in for the real tool execution), and
// claimExecution is stateful in-memory (first key wins, duplicates lose).
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  // Stateful exactly-once ledger: a key can only be claimed once.
  const claimed = new Map<string, { status: string; result: unknown }>();
  const claimExecution = vi.fn(async (key: string, _pid: string | null, _tool: string) => {
    if (claimed.has(key)) return { won: false, id: 'exec-existing', alreadyClaimed: true };
    claimed.set(key, { status: 'claimed', result: null });
    return { won: true, id: 'exec-new', alreadyClaimed: false };
  });
  const recordResult = vi.fn(async (key: string, status: string, result?: unknown) => {
    if (claimed.has(key)) claimed.set(key, { status, result: result ?? null });
  });
  const getExecution = vi.fn(async (key: string) => {
    const row = claimed.get(key);
    return row ? { id: 'exec-existing', tool: 'refund', status: row.status, result: row.result as any } : null;
  });

  // resumeThread === the real tool execution. Must be called exactly once.
  const resumeThread = vi.fn(async () => ({
    status: 'answered' as const,
    reply: 'Refund issued.',
    toolResult: 'refunded £15.00',
  }));

  const appendAudit = vi.fn(async () => ({}) as any);
  const q = vi.fn(async () => []);
  // SELECT id, ref, proposal → return the action proposal record every time.
  const q1 = vi.fn(async () => ({
    id: 'p1',
    ref: 'INV-0001',
    proposal: {
      ok: true,
      configured: true,
      action: { tool: 'refund', threadId: 'thread-1', callId: 'call_x1', args: { amount: 1500 } },
    },
  }));

  return { claimed, claimExecution, recordResult, getExecution, resumeThread, appendAudit, q, q1 };
});

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return true;
  },
  q: H.q,
  q1: H.q1,
}));

vi.mock('@/lib/data', () => ({ addTicketComment: vi.fn(async () => {}) }));

vi.mock('@/lib/hermes/exec-ledger', () => ({
  claimExecution: H.claimExecution,
  recordResult: H.recordResult,
  getExecution: H.getExecution,
}));

vi.mock('@/lib/hermes/audit', () => ({ appendAudit: H.appendAudit }));

// The dynamic import('@/lib/hermes/brain/graph') inside actOnProposal resolves to
// this mock → resumeThread is our single-execution spy (no real graph loaded).
vi.mock('@/lib/hermes/brain/graph', () => ({ resumeThread: H.resumeThread }));

import { actOnProposal } from '@/lib/hermes/proposals';

beforeEach(() => {
  H.claimed.clear();
  H.claimExecution.mockClear();
  H.recordResult.mockClear();
  H.getExecution.mockClear();
  H.resumeThread.mockClear();
  H.appendAudit.mockClear();
  H.q.mockClear();
  H.q1.mockClear();
});

describe('actOnProposal exactly-once (double approve)', () => {
  it('two approves on the same action proposal execute the tool ONCE', async () => {
    const first = await actOnProposal('p1', 'approve', 'ben');
    const second = await actOnProposal('p1', 'approve', 'ben');

    // Both calls report success to the operator...
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // ...but the underlying tool (resumeThread) ran EXACTLY ONCE.
    expect(H.resumeThread).toHaveBeenCalledTimes(1);

    // The winner recorded a success; the loser only looked up the prior result.
    expect(H.recordResult).toHaveBeenCalledTimes(1);
    expect(H.recordResult.mock.calls[0][1]).toBe('succeeded');
    expect(H.getExecution).toHaveBeenCalledTimes(1);

    // Both approves shared the same stable idempotency key: `${id}:${callId}`.
    expect(H.claimExecution.mock.calls[0][0]).toBe('p1:call_x1');
    expect(H.claimExecution.mock.calls[1][0]).toBe('p1:call_x1');

    // The executed decision was audited once.
    const executedAudits = H.appendAudit.mock.calls.filter(
      (c) => (c[0] as any)?.action === 'proposal.executed',
    );
    expect(executedAudits).toHaveLength(1);
  });

  it('a lost claim whose prior attempt FAILED surfaces the failure (still no re-run)', async () => {
    // Pre-seed a failed claim for the stable key so the first approve loses.
    H.claimed.set('p1:call_x1', { status: 'failed', result: { error: 'gateway down' } });

    const res = await actOnProposal('p1', 'approve', 'ben');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already executed/i);
    expect(H.resumeThread).not.toHaveBeenCalled();
  });
});
