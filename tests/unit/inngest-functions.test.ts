import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Inngest app-side workflows (lib/inngest/functions/*) + serve route gating.
//
// These tests prove the SAFETY contract without any real Inngest server:
//   • each function's exported handler, driven with a mocked `step`, only DRAFTS
//     a proposal via saveProposal (no email/money/tool ever auto-executes), and
//   • the serve endpoint NO-OPs (503) when HERMES_INNGEST_ENABLED is off.
//
// We mock '@/lib/hermes/proposals' + the Brain entry + the read-only tools + the
// signal helpers, so nothing touches a DB, network, or the real graph. The `step`
// fake runs work inline (step.run(id, fn) → fn()) and treats step.sleep as an
// instant no-op.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const saveProposal = vi.fn(async () => 'prop-123');
  // runPaTurn is now called per-persona; default answers a generic brief body.
  const runPaTurn = vi.fn(async () => ({ status: 'answered', reply: 'Brief body.' }));
  const getDeployRun = vi.fn(async () => ({ ok: true, summary: 'all green', data: [] as any[] }));
  const broadcastRun = vi.fn(async () => ({ ok: true, summary: 'broadcast', data: {} }));
  const checkBudget = vi.fn(async () => ({
    allowed: true,
    uncapped: true,
    capMinor: null,
    spentMinor: 0,
    reason: 'no DB — uncapped',
  }));
  // Churn signal: default is a healthy, not-tripped signal.
  const churnSignal = vi.fn(async () => ({
    configured: true,
    failedInvoices: 0,
    windowHours: 24,
    threshold: 3,
    severity: 'none' as const,
    tripped: false,
    detail: 'Failed payments in the last 24h: 0 (threshold 3).',
  }));
  // Cross-run de-dup gate: default is "fresh" (allow the alert).
  const claimWatcherAlert = vi.fn(async () => true);
  return { saveProposal, runPaTurn, getDeployRun, broadcastRun, checkBudget, churnSignal, claimWatcherAlert };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: H.saveProposal }));
vi.mock('@/lib/hermes/brain/graph', () => ({ runPaTurn: H.runPaTurn }));
vi.mock('@/lib/hermes/budget', () => ({ checkBudget: H.checkBudget }));
vi.mock('@/lib/hermes/brain/tools/deploy', () => ({
  getDeployStatusTool: { name: 'getDeployStatus', run: H.getDeployRun },
}));
vi.mock('@/lib/hermes/brain/tools/broadcast', () => ({
  broadcastStatusTool: { name: 'broadcastStatus', run: H.broadcastRun },
}));
vi.mock('@/lib/inngest/signals/churn', () => ({ churnSignal: H.churnSignal }));
vi.mock('@/lib/inngest/signals/watcher-state', () => ({
  claimWatcherAlert: H.claimWatcherAlert,
  DEFAULT_WATCHER_COOLDOWN_SECONDS: 21600,
}));

import { dunning, dunningHandler } from '@/lib/inngest/functions/dunning';
import {
  scheduledBriefs,
  scheduledBriefsHandler,
  scheduledDailyDigest,
  scheduledDailyDigestHandler,
} from '@/lib/inngest/functions/scheduled-briefs';
import { watchers, watchersHandler } from '@/lib/inngest/functions/watchers';

// A fake Inngest `step`: run() executes inline, sleep() is an instant no-op. This
// lets us drive the durable handlers deterministically in a unit test.
function fakeStep() {
  const runIds: string[] = [];
  const sleepIds: string[] = [];
  return {
    runIds,
    sleepIds,
    run: async <T>(id: string, fn: () => Promise<T> | T): Promise<T> => {
      runIds.push(id);
      return fn();
    },
    sleep: async (id: string) => {
      sleepIds.push(id);
      return undefined;
    },
  };
}

beforeEach(() => {
  Object.values(H).forEach((f) => (f as any).mockClear?.());
});

describe('Inngest functions are defined', () => {
  it('all four createFunction objects exist', () => {
    expect(dunning).toBeTruthy();
    expect(scheduledBriefs).toBeTruthy();
    expect(scheduledDailyDigest).toBeTruthy();
    expect(watchers).toBeTruthy();
  });
});

describe('dunning — failed-payment recovery (draft/gated only)', () => {
  it('drafts one proposal per stage and NEVER auto-sends', async () => {
    const step = fakeStep();
    const event = {
      name: 'payment.failed' as const,
      data: {
        invoiceId: 'inv_001',
        customerEmail: 'cust@example.com',
        amountMinor: 4200,
        currency: 'gbp',
      },
    };

    const res = await dunningHandler({ event, step });

    // One proposal per reminder stage (day-0/day-3/day-7).
    expect(H.saveProposal).toHaveBeenCalledTimes(3);
    expect(res.proposals).toEqual(['prop-123', 'prop-123', 'prop-123']);

    // Every proposal is a DRAFT (kind 'dunning', a body, no action block → no
    // auto-execution). This is the "no unilateral send" guarantee.
    for (const call of H.saveProposal.mock.calls) {
      const arg = (call as any[])[0];
      expect(arg.kind).toBe('dunning');
      expect(arg.proposal.draft).toBeTruthy();
      expect(arg.proposal.action).toBeUndefined();
    }

    // Deterministic, invoice-scoped step ids → replay-safe idempotency.
    expect(step.runIds).toContain('draft-day-0-inv_001');
    expect(step.sleepIds).toContain('wait-day-3-inv_001');
  });
});

describe('scheduled-briefs — weekly cron (persona-routed, draft only)', () => {
  it('invokes the finance (CFO) + ops (COO) personas and files ONE combined draft', async () => {
    const step = fakeStep();
    const res = await scheduledBriefsHandler({ step });

    // TWO Brain turns — one per persona — and they are the RIGHT personas.
    expect(H.runPaTurn).toHaveBeenCalledTimes(2);
    const personas = H.runPaTurn.mock.calls.map((c) => (c as any[])[0].persona);
    expect(personas).toContain('billing'); // CFO / finance
    expect(personas).toContain('ceo'); // COO / ops

    // Exactly ONE combined proposal, a DRAFT (no action block).
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = (H.saveProposal.mock.calls[0] as any[])[0];
    expect(arg.kind).toBe('brief');
    expect(arg.proposal.action).toBeUndefined();
    // The combined body carries both persona sections.
    expect(arg.proposal.draft).toContain('Finance (CFO)');
    expect(arg.proposal.draft).toContain('Operations (COO)');
    expect(arg.proposal.draft).toContain('Brief body.');
    expect(res.status).toBe('filed');
    expect(res.personas).toEqual(expect.arrayContaining(['billing', 'ceo']));
  });

  it('skips filing when the Brain is disabled for BOTH personas', async () => {
    H.runPaTurn.mockResolvedValue({ status: 'disabled' } as any);
    const step = fakeStep();
    const res = await scheduledBriefsHandler({ step });
    expect(res.status).toBe('skipped-brain-disabled');
    expect(H.saveProposal).not.toHaveBeenCalled();
    H.runPaTurn.mockResolvedValue({ status: 'answered', reply: 'Brief body.' } as any);
  });

  it('still files when one persona errors (the other section carries through)', async () => {
    H.runPaTurn.mockResolvedValueOnce({ status: 'error', error: 'model down' } as any);
    const step = fakeStep();
    const res = await scheduledBriefsHandler({ step });
    expect(res.status).toBe('filed');
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = (H.saveProposal.mock.calls[0] as any[])[0];
    // The errored section is noted, not dropped silently.
    expect(arg.proposal.draft).toContain('errored');
  });
});

describe('scheduled-briefs — daily ops digest (draft only)', () => {
  it('runs the ops (COO) persona once and files a draft digest', async () => {
    const step = fakeStep();
    const res = await scheduledDailyDigestHandler({ step });
    expect(H.runPaTurn).toHaveBeenCalledTimes(1);
    expect((H.runPaTurn.mock.calls[0] as any[])[0].persona).toBe('ceo');
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = (H.saveProposal.mock.calls[0] as any[])[0];
    expect(arg.kind).toBe('brief');
    expect(arg.proposal.action).toBeUndefined();
    expect(res.status).toBe('filed');
  });
});

describe('watchers — health-signal cron (draft/gated only)', () => {
  it('does nothing when all signals are healthy', async () => {
    const step = fakeStep();
    const res = await watchersHandler({ step });
    expect(res.trips).toHaveLength(0);
    expect(H.saveProposal).not.toHaveBeenCalled();
    expect(H.broadcastRun).not.toHaveBeenCalled();
    expect(H.claimWatcherAlert).not.toHaveBeenCalled(); // no trip → no claim
  });

  it('on a failing deploy: broadcasts + opens a DRAFT proposal (no remediation)', async () => {
    H.getDeployRun.mockResolvedValueOnce({
      ok: true,
      summary: 'sentinel build failed',
      data: [
        {
          repo: 'lewis159/youtube-transcriber',
          latestRun: { name: 'CI', branch: 'main', conclusion: 'failure', status: 'completed' },
          openPRs: [],
        },
      ],
    });
    const step = fakeStep();
    const res = await watchersHandler({ step });

    expect(res.trips.some((t) => t.signal === 'deploy')).toBe(true);
    expect(H.broadcastRun).toHaveBeenCalledTimes(1);
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = (H.saveProposal.mock.calls[0] as any[])[0];
    expect(arg.kind).toBe('watcher');
    expect(arg.proposal.action).toBeUndefined(); // draft only — nothing executed
  });

  it('on a budget breach: opens a DRAFT proposal', async () => {
    H.checkBudget.mockResolvedValueOnce({
      allowed: false,
      uncapped: false,
      capMinor: 1000,
      spentMinor: 1500,
      reason: 'cap exceeded',
    });
    const step = fakeStep();
    const res = await watchersHandler({ step });
    expect(res.trips.some((t) => t.signal === 'budget')).toBe(true);
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
  });

  it('CHURN SPIKE: trips, files ONE draft proposal, and NEVER remediates', async () => {
    H.churnSignal.mockResolvedValueOnce({
      configured: true,
      failedInvoices: 7,
      windowHours: 24,
      threshold: 3,
      severity: 'spike',
      tripped: true,
      detail: 'Churn spike (proxy): 7 failed payment(s) in the last 24h (threshold 3).',
    });
    const step = fakeStep();
    const res = await watchersHandler({ step });

    expect(res.trips.some((t) => t.signal === 'churn')).toBe(true);
    expect(H.claimWatcherAlert).toHaveBeenCalledTimes(1);
    expect(H.broadcastRun).toHaveBeenCalledTimes(1);
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = (H.saveProposal.mock.calls[0] as any[])[0];
    expect(arg.kind).toBe('watcher');
    expect(arg.proposal.draft).toContain('churn');
    expect(arg.proposal.action).toBeUndefined(); // no action attached — draft only
  });

  it('DEDUP: an ongoing churn spike does NOT re-alert on the next tick', async () => {
    // Both ticks see the SAME churn spike condition.
    H.churnSignal.mockResolvedValue({
      configured: true,
      failedInvoices: 7,
      windowHours: 24,
      threshold: 3,
      severity: 'spike',
      tripped: true,
      detail: 'Churn spike (proxy): 7 failed payment(s) in the last 24h (threshold 3).',
    });

    // Tick 1: claim is fresh → alert fires.
    H.claimWatcherAlert.mockResolvedValueOnce(true);
    const res1 = await watchersHandler({ step: fakeStep() });
    expect(res1.deduped).toBeUndefined();
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    expect(H.broadcastRun).toHaveBeenCalledTimes(1);

    // Tick 2: SAME fingerprint within cooldown → claim refused → NO new alert.
    H.claimWatcherAlert.mockResolvedValueOnce(false);
    const res2 = await watchersHandler({ step: fakeStep() });
    expect(res2.deduped).toBe(true);
    expect(res2.trips.some((t) => t.signal === 'churn')).toBe(true); // still detected…
    // …but NOT re-broadcast / re-filed: counts are unchanged from tick 1.
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    expect(H.broadcastRun).toHaveBeenCalledTimes(1);

    // Both ticks passed the SAME fingerprint to the de-dup gate.
    const fp1 = (H.claimWatcherAlert.mock.calls[0] as any[])[1];
    const fp2 = (H.claimWatcherAlert.mock.calls[1] as any[])[1];
    expect(fp1).toBe(fp2);

    H.churnSignal.mockResolvedValue({
      configured: true,
      failedInvoices: 0,
      windowHours: 24,
      threshold: 3,
      severity: 'none',
      tripped: false,
      detail: 'Failed payments in the last 24h: 0 (threshold 3).',
    });
  });
});
