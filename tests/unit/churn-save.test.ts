import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Churn-Save Outreach — at-risk scoring + gated win-back drafts.
//
// Proves three things without any DB, network, or LLM:
//   1. the PURE scorer ranks accounts from mock signals deterministically;
//   2. with the Brain OFF, the draft is the deterministic TEMPLATE (no model call);
//   3. queuing a win-back creates a DRAFT 'churn-save' proposal with NO action
//      block — i.e. it never sends and never fires the Resend tool.
//
// We mock 'server-only' + the data/proposal/brain modules so importing the lib
// files under test touches nothing real.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => ({
  brainEnabled: vi.fn(() => false),
  callModel: vi.fn(async () => ({ ok: true, content: 'AI refined body.\n— The Scribuo team', toolCalls: [], model: 'test-model' })),
  saveProposal: vi.fn(async () => 'prop-churn-1'),
  getTicketsByKind: vi.fn(async () => ({ rows: [], live: false })),
  listProposals: vi.fn(async () => [] as any[]),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/hermes/brain/flags', () => ({ brainEnabled: H.brainEnabled }));
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: H.callModel }));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: H.saveProposal }));
vi.mock('@/lib/data', () => ({ getTicketsByKind: H.getTicketsByKind }));

import { scoreAtRisk, type AtRiskAccount, type TicketSignal, type DunningSignal } from '@/lib/churn/at-risk';
import { templateWinBack, generateWinBack, queueWinBack } from '@/lib/churn/win-back';

beforeEach(() => {
  Object.values(H).forEach((f) => (f as any).mockClear?.());
  H.brainEnabled.mockReturnValue(false);
});

// A small, deterministic set of mock signals.
const tickets: TicketSignal[] = [
  // Acme — an urgent open incident + a stalled ageing ticket + failed payment below.
  { ref: 'INC-1', tenantRef: 'acme', email: 'ops@acme.co', customerName: 'Acme Co', priority: 'critical', status: 'in_progress', title: 'Service down', description: 'queue stalled', age: '5d' },
  // Globex — a complaint (negative language), open.
  { ref: 'REQ-9', tenantRef: 'globex', email: 'it@globex.com', customerName: 'Globex Media', priority: 'medium', status: 'open', title: 'We want to cancel our plan', description: 'thinking of switching', age: '1d' },
  // Internal ticket — no customer identity → must be ignored.
  { ref: 'CHG-1', tenantRef: null, email: null, customerName: null, priority: 'high', status: 'open', title: 'Rotate key', description: '', age: '2d' },
  // Northwind — a low-priority open ticket, no risk language → below threshold.
  { ref: 'INC-3', tenantRef: 'northwind', email: 'ops@northwind.io', customerName: 'Northwind Labs', priority: 'low', status: 'open', title: 'Question about export', description: 'how do I export', age: '1h' },
];
const dunning: DunningSignal[] = [
  { ref: 'invoice:inv_001', tenantRef: null, email: 'ops@acme.co', stage: 'day-7', createdAt: '2026-07-10T00:00:00Z' },
  // Duplicate reminder (same invoice, earlier stage) must NOT double-count.
  { ref: 'invoice:inv_001', tenantRef: null, email: 'ops@acme.co', stage: 'day-0', createdAt: '2026-07-03T00:00:00Z' },
];

describe('scoreAtRisk — ranking from mock signals', () => {
  const ranked = () => scoreAtRisk({ tickets, dunning });

  it('ranks the account with a failed payment + urgent ticket highest', () => {
    const out = ranked();
    expect(out[0].email).toBe('ops@acme.co');
    expect(out[0].label).toBe('Acme Co');
    // failed payment (22) + final-notice (12) + urgent open (20) + stalled (8) = 62
    expect(out[0].riskScore).toBe(62);
    expect(out[0].failedPayments).toBe(1); // deduped by invoice
    expect(out[0].reasons.some((r) => /Failed payment/i.test(r))).toBe(true);
    expect(out[0].reasons.some((r) => /Urgent open/i.test(r))).toBe(true);
    expect(out[0].lastSignal).toBeTruthy();
  });

  it('includes the complaint account and drops zero-risk + internal tickets', () => {
    const out = ranked();
    const keys = out.map((a) => a.key);
    expect(keys).toContain('it@globex.com'); // negative language → at risk
    expect(keys).not.toContain('ops@northwind.io'); // low-pri, no risk language → excluded
    expect(keys).not.toContain('unknown'); // internal ticket ignored (no identity)
    // Deterministic descending order.
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].riskScore).toBeGreaterThanOrEqual(out[i].riskScore);
    }
  });

  it('is deterministic across runs', () => {
    expect(scoreAtRisk({ tickets, dunning })).toEqual(scoreAtRisk({ tickets, dunning }));
  });
});

const acme: AtRiskAccount = {
  key: 'ops@acme.co',
  tenantRef: 'acme',
  email: 'ops@acme.co',
  label: 'Acme Co',
  riskScore: 62,
  reasons: ['Failed payment (dunning day-7, final notice) — invoice:inv_001', 'Urgent open ticket — INC-1'],
  lastSignal: 'Failed payment · day-7',
  failedPayments: 1,
  openTickets: 1,
};

describe('generateWinBack — draft generation', () => {
  it('brain OFF → uses the deterministic template and NEVER calls the model', async () => {
    H.brainEnabled.mockReturnValue(false);
    const draft = await generateWinBack(acme);
    expect(H.callModel).not.toHaveBeenCalled();
    expect(draft.refined).toBe(false);
    expect(draft.to).toBe('ops@acme.co');
    expect(draft.subject).toMatch(/lapse/i); // billing-flavoured subject
    expect(draft.body).toBe(templateWinBack(acme).body);
    expect(draft.body).toContain('— The Scribuo team');
  });

  it('brain ON → refines the body via the model (draft only)', async () => {
    H.brainEnabled.mockReturnValue(true);
    const draft = await generateWinBack(acme);
    expect(H.callModel).toHaveBeenCalledTimes(1);
    expect(draft.refined).toBe(true);
    expect(draft.body).toContain('AI refined body.');
    expect(draft.model).toBe('test-model');
  });

  it('brain ON but model errors → silently falls back to the template', async () => {
    H.brainEnabled.mockReturnValue(true);
    H.callModel.mockResolvedValueOnce({ ok: false, error: 'boom' } as any);
    const draft = await generateWinBack(acme);
    expect(draft.refined).toBe(false);
    expect(draft.body).toBe(templateWinBack(acme).body);
  });
});

describe('queueWinBack — gated proposal (NO send)', () => {
  it('creates a DRAFT churn-save proposal with no action block', async () => {
    H.brainEnabled.mockReturnValue(false);
    const { proposalId, draft } = await queueWinBack(acme);

    expect(proposalId).toBe('prop-churn-1');
    expect(draft.body).toBeTruthy();

    // Exactly one proposal, of the right kind, carrying the drafted email.
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    const arg = (H.saveProposal.mock.calls[0] as any[])[0];
    expect(arg.kind).toBe('churn-save');
    expect(arg.agent).toBe('churn-save');
    expect(arg.proposal.draft).toBe(draft.body);
    expect(arg.proposal.classification).toContain(draft.subject);
    // THE GATE: no action block → approval never resumes a graph / fires Resend.
    expect(arg.proposal.action).toBeUndefined();
    // ref is scoped to the tenant so the proposal links back to the account.
    expect(arg.ref).toBe('tenant:acme');
  });
});
