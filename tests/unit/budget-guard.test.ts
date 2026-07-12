import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P3 wiring proof for the budget guard in graph.toolsNode. execWithBudget is the
// gate wrapped around every real tool execution (both the approved-gated and the
// auto site): a SPENDING tool (estimateMinor > 0) is checked against the persona
// cap BEFORE it runs — if over budget it does NOT run and a budget-denied
// observation is surfaced; a zero-cost read tool skips the check entirely.
//
// We mock the graph's module deps the copilot-action.test.ts way so importing
// graph.ts is cheap, and mock '@/lib/hermes/budget' so we drive checkBudget's
// verdict directly.
// ---------------------------------------------------------------------------

process.env.HERMES_BRAIN_ENABLED = '1';

const H = vi.hoisted(() => {
  const checkBudget = vi.fn(async () => ({ allowed: true, reason: undefined as string | undefined }));
  const recordSpend = vi.fn(async () => {});
  return { checkBudget, recordSpend };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  get hasDb() {
    return false;
  },
  q: vi.fn(async () => []),
  q1: vi.fn(async () => null),
}));
vi.mock('@/lib/hermes/kb-context', () => ({ retrieveKb: vi.fn(async () => []) }));
vi.mock('@/lib/hermes/brain/checkpointer', () => ({ getCheckpointer: vi.fn(async () => null) }));
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: vi.fn(async () => ({ ok: true, content: '', toolCalls: [], model: 'mock' })) }));
vi.mock('@/lib/data', () => ({
  getServiceTicket: vi.fn(async () => ({ row: null, live: false })),
  updateTicket: vi.fn(async () => ({ row: null, live: false })),
  addTicketComment: vi.fn(async () => {}),
  getTicketsByKind: vi.fn(async () => ({ rows: [], live: false })),
}));
vi.mock('@/lib/hermes/budget', () => ({ checkBudget: H.checkBudget, recordSpend: H.recordSpend }));

import { execWithBudget } from '@/lib/hermes/brain/graph';
import type { BrainTool, ToolContext } from '@/lib/hermes/brain/tools/types';

const ctx: ToolContext = { threadId: 't', persona: 'billing', actor: 'ben' };

function makeTool(overrides: Partial<BrainTool> & { estimateMinor?: (a: any) => number }): BrainTool {
  return {
    name: 'refund',
    description: 'issue a refund',
    schema: {} as any,
    autonomy: 'gated',
    run: vi.fn(async () => ({ ok: true, summary: 'refunded' })),
    ...overrides,
  } as BrainTool;
}

beforeEach(() => {
  H.checkBudget.mockClear();
  H.recordSpend.mockClear();
  H.checkBudget.mockResolvedValue({ allowed: true, reason: undefined });
});

describe('execWithBudget — budget guard around a tool execution', () => {
  it('DENIES a spending tool over budget and does NOT run it', async () => {
    H.checkBudget.mockResolvedValueOnce({ allowed: false, reason: 'cap 1500 would be exceeded' });
    const run = vi.fn(async () => ({ ok: true, summary: 'refunded' }));
    const tool = makeTool({ estimateMinor: () => 2000, run });

    const res = await execWithBudget(tool, 'refund', { amount: 2000 }, ctx, 'billing');

    expect(res.denied).toBe(true);
    if (res.denied) expect(res.message).toMatch(/budget cap reached/i);
    expect(run).not.toHaveBeenCalled();      // the money tool never ran
    expect(H.recordSpend).not.toHaveBeenCalled();
    expect(H.checkBudget).toHaveBeenCalledWith('billing', 'refund', 2000);
  });

  it('ALLOWS a spending tool under budget, runs it, and records the spend', async () => {
    const run = vi.fn(async () => ({ ok: true, summary: 'refunded' }));
    const tool = makeTool({ estimateMinor: () => 500, run });

    const res = await execWithBudget(tool, 'refund', { amount: 500 }, ctx, 'billing');

    expect(res.denied).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(H.recordSpend).toHaveBeenCalledWith('billing', 'refund', 500, { note: 'refund' });
  });

  it('a zero-cost read tool SKIPS budgeting entirely', async () => {
    const run = vi.fn(async () => ({ ok: true, summary: 'read ok' }));
    const tool = makeTool({ name: 'getTicket', autonomy: 'auto', run }); // no estimateMinor

    const res = await execWithBudget(tool, 'getTicket', { ref: 'INC-1' }, ctx, 'billing');

    expect(res.denied).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(H.checkBudget).not.toHaveBeenCalled();   // no cost → no check
    expect(H.recordSpend).not.toHaveBeenCalled();
  });

  it('does NOT record spend when a spending tool FAILS', async () => {
    const run = vi.fn(async () => ({ ok: false, summary: 'gateway down', error: 'timeout' }));
    const tool = makeTool({ estimateMinor: () => 500, run });

    const res = await execWithBudget(tool, 'refund', { amount: 500 }, ctx, 'billing');

    expect(res.denied).toBe(false);
    if (!res.denied) expect(res.result.ok).toBe(false);
    expect(H.recordSpend).not.toHaveBeenCalled();
  });
});
