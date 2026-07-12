import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NODB, hasDbUrl, SKIP_MESSAGE } from './_helpers';

// ---------------------------------------------------------------------------
// SPINE — proposals + exactly-once, end-to-end against REAL Postgres.
//
// Unlike the unit test (tests/unit/proposal-exactly-once.test.ts) which mocks the
// whole DB, here lib/db, lib/hermes/exec-ledger, lib/hermes/audit and
// lib/hermes/proposals are ALL REAL and hit the database. The ONLY things stubbed
// are the boundaries that aren't the subject of this test:
//   * `server-only`                  — importable outside an RSC bundle.
//   * `@/lib/data` addTicketComment  — the draft-post side-effect (unused here).
//   * `@/lib/hermes/brain/graph`     — resumeThread IS the gated tool execution;
//                                      we count how many times it actually runs.
//
// The exactly-once guarantee is therefore proved by the REAL ops.hermes_tool_
// executions UNIQUE(idempotency_key) index arbitrating two concurrent-ish
// approves — not by an in-memory fake.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const state = { resumeCalls: 0 };
  return { state };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', () => ({ addTicketComment: vi.fn(async () => {}) }));
// resumeThread === the gated tool execution. It must run AT MOST ONCE no matter
// how many approves land on the same proposal.
vi.mock('@/lib/hermes/brain/graph', () => ({
  resumeThread: vi.fn(async () => {
    H.state.resumeCalls++;
    return { status: 'answered', reply: 'Refund issued.', toolResult: 'refunded £15.00' };
  }),
}));

// Imported AFTER the mocks are registered (vi.mock is hoisted above imports).
import { saveActionProposal, actOnProposal, getHermesProposal } from '@/lib/hermes/proposals';
import { getExecution } from '@/lib/hermes/exec-ledger';
import { q } from '@/lib/db';

// A unique ref so this run's rows are trivially identifiable + cleanable.
const REF = `ITEST-SPINE-${Date.now()}`;
const createdIds: string[] = [];

if (NODB) {
  // eslint-disable-next-line no-console
  console.log(`[spine.test] ${SKIP_MESSAGE}`);
}

describe.runIf(NODB)('spine (skipped, no DATABASE_URL)', () => {
  it('no DB — skipped', () => {
    expect(hasDbUrl).toBe(false);
  });
});

describe.skipIf(NODB)('SPINE: proposals + exactly-once (real SQL)', () => {
  beforeAll(() => {
    H.state.resumeCalls = 0;
  });

  afterAll(async () => {
    // Proposals + executions are deletable (the audit log is append-only and is
    // intentionally left intact).
    for (const id of createdIds) {
      await q('delete from ops.hermes_tool_executions where proposal_id = $1', [id]);
      await q('delete from ops.hermes_proposals where id = $1', [id]);
    }
  });

  it('saveActionProposal persists a real ops.hermes_proposals row (+ audit)', async () => {
    const id = await saveActionProposal({
      ref: REF,
      agent: 'billing',
      title: 'Refund £15.00',
      summary: 'Customer requested a refund',
      tool: 'refund',
      args: { amount: 1500 },
      threadId: `thread-${REF}`,
      callId: 'call_persist',
    });
    expect(id).toBeTruthy();
    createdIds.push(id!);

    const rows = await q<any>(
      `select id, kind, status, agent, ref, proposal from ops.hermes_proposals where id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('action');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].agent).toBe('billing');
    // The pending gated tool call is carried inside proposal.action.
    const proposal = typeof rows[0].proposal === 'string' ? JSON.parse(rows[0].proposal) : rows[0].proposal;
    expect(proposal.action.tool).toBe('refund');

    // saveProposal appended a real proposal.created audit row for this id.
    const audit = await q<any>(
      `select action from ops.hermes_audit_log where proposal_id = $1 and action = 'proposal.created'`,
      [id],
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('double-approve executes the gated tool EXACTLY ONCE (UNIQUE ledger wins once)', async () => {
    H.state.resumeCalls = 0;

    const id = await saveActionProposal({
      ref: REF,
      agent: 'billing',
      title: 'Refund £15.00',
      summary: 'Customer requested a refund',
      tool: 'refund',
      args: { amount: 1500 },
      threadId: `thread-once-${REF}`,
      callId: 'call_once',
    });
    expect(id).toBeTruthy();
    createdIds.push(id!);

    // Two approves on the same proposal (a retry / double-submit / two operators).
    const first = await actOnProposal(id!, 'approve', 'ben');
    const second = await actOnProposal(id!, 'approve', 'ben');

    // Both report success to the operator...
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // ...but the gated tool actually ran ONCE.
    expect(H.state.resumeCalls).toBe(1);

    // The REAL ledger holds exactly one row for this proposal, marked succeeded —
    // the exactly-once decision was made by the UNIQUE(idempotency_key) index.
    const ledger = await q<any>(
      `select idempotency_key, status from ops.hermes_tool_executions where proposal_id = $1`,
      [id],
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe('succeeded');
    expect(ledger[0].idempotency_key).toBe(`${id}:call_once`);

    // getExecution (real) reports the winner's recorded success.
    const exec = await getExecution(`${id}:call_once`);
    expect(exec?.status).toBe('succeeded');

    // The proposal is now 'sent' and the executed decision was audited once.
    const rec = await getHermesProposal(id!);
    expect(rec?.status).toBe('sent');
    const executed = await q<any>(
      `select count(*)::int as c from ops.hermes_audit_log where proposal_id = $1 and action = 'proposal.executed'`,
      [id],
    );
    expect(executed[0].c).toBe(1);
  });
});
