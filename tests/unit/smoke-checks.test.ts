import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for the live smoke runner (lib/smoke/checks.ts). Every heavy /
// server-only dependency is mocked so importing the module never pulls in
// LangGraph / pg / Clerk. We prove:
//   • safe() turns a THROW into a `fail` result (the runner never crashes).
//   • a normal check returns `pass`.
//   • the action-tool not_configured check calls run() when a key is absent and
//     asserts not_configured — and SKIPS (never calls run()) when a key is present.
//   • the write-then-cleanup checks call their cleanup (dismiss proposal / delete
//     ledger row).
//   • runSmokeChecks() summarises and downgrades a throwing check to `fail`.
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

// --- @/lib/db (controllable hasDb + SQL-routed q/q1) -----------------------
const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const q = vi.fn(async (_sql: string, _params?: any[]) => [] as any[]);
  const q1 = vi.fn(async (sql: string, _params?: any[]) => {
    if (/select 1 as ok/i.test(sql)) return { ok: 1 };
    if (/relrowsecurity/i.test(sql)) return { on: false };
    if (/count\(\*\)/i.test(sql)) return { n: 1 };
    return null;
  });
  return { state, q, q1 };
});
vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
}));

// --- flags / inngest / config ----------------------------------------------
const F = vi.hoisted(() => ({
  brain: false,
  hasKey: false,
}));
vi.mock('@/lib/hermes/brain/flags', () => ({
  brainEnabled: () => F.brain,
  intakeEnabled: () => false,
  kbPgvectorEnabled: () => false,
}));
vi.mock('@/lib/inngest/client', () => ({ inngestEnabled: () => false }));

// All spy fns live in a hoisted block so the vi.mock factories (hoisted to the top
// of the file) can reference them without a temporal-dead-zone error.
const M = vi.hoisted(() => ({
  getHermesRuntimeConfig: vi.fn(),
  runPaTurn: vi.fn(),
  saveActionProposal: vi.fn(),
  getHermesProposal: vi.fn(),
  actOnProposal: vi.fn(),
  claimExecution: vi.fn(),
  getExecution: vi.fn(),
  recordResult: vi.fn(),
  verifyChain: vi.fn(),
  getSecret: vi.fn(),
  stripeRun: vi.fn(),
  emailRun: vi.fn(),
  githubRun: vi.fn(),
}));
const {
  runPaTurn,
  saveActionProposal,
  getHermesProposal,
  actOnProposal,
  claimExecution,
  verifyChain,
  stripeRun,
  emailRun,
  githubRun,
} = M;

vi.mock('@/lib/hermes/config', () => ({ getHermesRuntimeConfig: M.getHermesRuntimeConfig }));
vi.mock('@/lib/hermes/brain/graph', () => ({ runPaTurn: M.runPaTurn }));
vi.mock('@/lib/hermes/proposals', () => ({
  saveActionProposal: M.saveActionProposal,
  getHermesProposal: M.getHermesProposal,
  actOnProposal: M.actOnProposal,
}));
vi.mock('@/lib/hermes/exec-ledger', () => ({
  claimExecution: M.claimExecution,
  getExecution: M.getExecution,
  recordResult: M.recordResult,
}));
vi.mock('@/lib/hermes/audit', () => ({ verifyChain: M.verifyChain }));
vi.mock('@/lib/secrets', () => ({ getSecret: M.getSecret }));
vi.mock('@/lib/hermes/brain/tools/stripe', () => ({ refundChargeTool: { name: 'refundCharge', run: M.stripeRun } }));
vi.mock('@/lib/hermes/brain/tools/email', () => ({ sendEmailTool: { name: 'sendEmail', run: M.emailRun } }));
vi.mock('@/lib/hermes/brain/tools/github', () => ({ triggerWorkflowTool: { name: 'triggerWorkflow', run: M.githubRun } }));

import {
  safe,
  dbReachableCheck,
  actionToolsNotConfiguredCheck,
  gatedProposalCheck,
  exactlyOnceCheck,
  runSmokeChecks,
} from '@/lib/smoke/checks';

beforeEach(() => {
  H.state.dbPresent = true;
  F.brain = false;
  F.hasKey = false;
  vi.clearAllMocks();
  // Default implementations (hoisted vi.fn()s have none until set here).
  M.getHermesRuntimeConfig.mockImplementation(async () => ({ hasKey: F.hasKey, model: 'test/model' }));
  M.runPaTurn.mockImplementation(async () => ({ status: 'answered', reply: 'OK', model: 'test/model' }));
  M.saveActionProposal.mockImplementation(async () => 'prop-smoke-1');
  M.getHermesProposal.mockImplementation(async () => ({
    id: 'prop-smoke-1',
    status: 'pending',
    proposal: { action: { tool: 'updateTicket' } }, // no executedAt / result
  }));
  M.actOnProposal.mockImplementation(async () => ({ ok: true }));
  M.getExecution.mockImplementation(async () => ({ id: 'e1', tool: '__smoke_noop__', status: 'succeeded', result: null }));
  M.recordResult.mockImplementation(async () => undefined);
  M.verifyChain.mockImplementation(async () => ({ ok: true, count: 3, brokenAtSeq: null }));
  M.getSecret.mockImplementation(async () => undefined);
  M.stripeRun.mockImplementation(async () => ({ ok: false, summary: 'x', error: 'not_configured' }));
  M.emailRun.mockImplementation(async () => ({ ok: false, summary: 'x', error: 'not_configured' }));
  M.githubRun.mockImplementation(async () => ({ ok: false, summary: 'x', error: 'not_configured' }));
  // Stateful exactly-once mock: the first claim for a given key wins, any repeat
  // loses. Robust regardless of how many checks call it (no once-queue to drain).
  const claimed = new Set<string>();
  claimExecution.mockImplementation(async (key: string) => {
    if (claimed.has(key)) return { won: false, id: 'e1', alreadyClaimed: true };
    claimed.add(key);
    return { won: true, id: 'e1', alreadyClaimed: false };
  });
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API;
  delete process.env.HERMES_GITHUB_TOKEN;
});

describe('safe() wrapper', () => {
  it('passes through a normal result with name + ms', async () => {
    const r = await safe('demo', async () => ({ status: 'pass', detail: 'good' }));
    expect(r.name).toBe('demo');
    expect(r.status).toBe('pass');
    expect(r.detail).toBe('good');
    expect(typeof r.ms).toBe('number');
  });

  it('turns a THROW into a fail result (never crashes)', async () => {
    const r = await safe('boom', async () => {
      throw new Error('kaboom');
    });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('kaboom');
  });
});

describe('dbReachableCheck', () => {
  it('passes when select 1 returns 1', async () => {
    expect(await dbReachableCheck()).toEqual({ status: 'pass', detail: expect.stringContaining('select 1') });
  });
  it('skips with no DB', async () => {
    H.state.dbPresent = false;
    expect((await dbReachableCheck()).status).toBe('skip');
  });
});

describe('actionToolsNotConfiguredCheck', () => {
  it('calls run() and asserts not_configured when keys are absent', async () => {
    const r = await actionToolsNotConfiguredCheck();
    expect(r.status).toBe('pass');
    expect(stripeRun).toHaveBeenCalledTimes(1);
    expect(emailRun).toHaveBeenCalledTimes(1);
    expect(githubRun).toHaveBeenCalledTimes(1);
  });

  it('SKIPS (never calls run) when every key is present — no real API call', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk';
    process.env.RESEND_API = 're';
    process.env.HERMES_GITHUB_TOKEN = 'gh';
    const r = await actionToolsNotConfiguredCheck();
    expect(r.status).toBe('skip');
    expect(stripeRun).not.toHaveBeenCalled();
    expect(emailRun).not.toHaveBeenCalled();
    expect(githubRun).not.toHaveBeenCalled();
  });

  it('fails (no throw) if a tool does NOT return not_configured', async () => {
    stripeRun.mockResolvedValueOnce({ ok: true, summary: 'oops' } as any);
    const r = await actionToolsNotConfiguredCheck();
    expect(r.status).toBe('fail');
  });
});

describe('gatedProposalCheck (write → cleanup)', () => {
  it('passes and DISMISSES the test proposal for cleanup', async () => {
    const r = await gatedProposalCheck();
    expect(r.status).toBe('pass');
    expect(saveActionProposal).toHaveBeenCalledTimes(1);
    // Test-tagged ref + agent.
    const arg = saveActionProposal.mock.calls[0][0] as any;
    expect(arg.ref).toMatch(/^__smoke__:/);
    expect(arg.agent).toBe('__smoke__');
    // Cleanup: dismissed.
    expect(actOnProposal).toHaveBeenCalledWith('prop-smoke-1', 'dismiss', '__smoke__');
  });

  it('fails if the proposal comes back executed', async () => {
    getHermesProposal.mockResolvedValueOnce({
      id: 'prop-smoke-1',
      status: 'sent',
      proposal: { action: { tool: 'updateTicket', executedAt: '2026-01-01' } },
    } as any);
    const r = await gatedProposalCheck();
    expect(r.status).toBe('fail');
    // Still cleans up.
    expect(actOnProposal).toHaveBeenCalled();
  });
});

describe('exactlyOnceCheck (write → cleanup)', () => {
  it('passes when first claim wins, second loses, ledger has 1 row — then deletes it', async () => {
    const r = await exactlyOnceCheck();
    expect(r.status).toBe('pass');
    expect(claimExecution).toHaveBeenCalledTimes(2);
    // Cleanup: DELETE of the test-tagged ledger row.
    const del = H.q.mock.calls.find((c) => /delete from ops\.hermes_tool_executions/i.test(c[0] as string));
    expect(del).toBeTruthy();
    expect((del![1] as any[])[0]).toMatch(/^__smoke__:exec:/);
  });

  it('skips with no DB', async () => {
    H.state.dbPresent = false;
    expect((await exactlyOnceCheck()).status).toBe('skip');
  });
});

describe('runSmokeChecks()', () => {
  it('never crashes and downgrades a throwing check to fail', async () => {
    verifyChain.mockRejectedValueOnce(new Error('audit exploded'));
    const run = await runSmokeChecks();
    expect(run.checks.length).toBeGreaterThan(0);
    const audit = run.checks.find((c) => c.name === 'audit_chain');
    expect(audit?.status).toBe('fail');
    expect(audit?.detail).toContain('audit exploded');
    // Summary reflects the failure; runner returned a coherent object.
    expect(run.summary.ok).toBe(false);
    expect(run.summary.total).toBe(run.checks.length);
  });
});
