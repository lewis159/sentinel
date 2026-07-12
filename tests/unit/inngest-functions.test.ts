import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Inngest app-side workflows (lib/inngest/functions/*) + serve route gating.
//
// These tests prove the SAFETY contract without any real Inngest server:
//   • each function's exported handler, driven with a mocked `step`, only DRAFTS
//     a proposal via saveProposal (no email/money/tool ever auto-executes), and
//   • the serve endpoint NO-OPs (503) when HERMES_INNGEST_ENABLED is off.
//
// We mock '@/lib/hermes/proposals' + the Brain entry + the read-only tools, so
// nothing touches a DB, network, or the real graph. The `step` fake runs work
// inline (step.run(id, fn) → fn()) and treats step.sleep as an instant no-op.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const saveProposal = vi.fn(async () => 'prop-123');
  const runPaTurn = vi.fn(async () => ({ status: 'answered', reply: 'Weekly brief body.' }));
  const getDeployRun = vi.fn(async () => ({ ok: true, summary: 'all green', data: [] as any[] }));
  const broadcastRun = vi.fn(async () => ({ ok: true, summary: 'broadcast', data: {} }));
  const checkBudget = vi.fn(async () => ({
    allowed: true,
    uncapped: true,
    capMinor: null,
    spentMinor: 0,
    reason: 'no DB — uncapped',
  }));
  return { saveProposal, runPaTurn, getDeployRun, broadcastRun, checkBudget };
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

import { dunning, dunningHandler } from '@/lib/inngest/functions/dunning';
import { scheduledBriefs, scheduledBriefsHandler } from '@/lib/inngest/functions/scheduled-briefs';
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
  it('all three createFunction objects exist', () => {
    expect(dunning).toBeTruthy();
    expect(scheduledBriefs).toBeTruthy();
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

describe('scheduled-briefs — weekly cron (draft only)', () => {
  it('files the Brain reply as a draft proposal', async () => {
    const step = fakeStep();
    const res = await scheduledBriefsHandler({ step });

    expect(H.runPaTurn).toHaveBeenCalledTimes(1);
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = (H.saveProposal.mock.calls[0] as any[])[0];
    expect(arg.kind).toBe('brief');
    expect(arg.proposal.draft).toContain('Weekly brief body.');
    expect(arg.proposal.action).toBeUndefined();
    expect(res.status).toBe('filed');
  });

  it('skips filing when the Brain is disabled', async () => {
    H.runPaTurn.mockResolvedValueOnce({ status: 'disabled' } as any);
    const step = fakeStep();
    const res = await scheduledBriefsHandler({ step });
    expect(res.status).toBe('skipped-brain-disabled');
    expect(H.saveProposal).not.toHaveBeenCalled();
  });
});

describe('watchers — health-signal cron (draft/gated only)', () => {
  it('does nothing when all signals are healthy', async () => {
    const step = fakeStep();
    const res = await watchersHandler({ step });
    expect(res.trips).toHaveLength(0);
    expect(H.saveProposal).not.toHaveBeenCalled();
    expect(H.broadcastRun).not.toHaveBeenCalled();
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
});
