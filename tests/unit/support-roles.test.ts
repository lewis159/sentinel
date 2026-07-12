import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P3 — support team roles + ticket assignment.
//
// Part 1 (pure): the support-action authorization in lib/support/roles.ts —
//   WHO can reply/resolve/assign/escalate directly, and how refunds/credits/
//   account changes are FORCED to the human gate (never 'allow').
// Part 2 (data): assignTicket / getTicketsAssignedTo in lib/data.ts, exercised
//   with '@/lib/db' mocked the same way tenant-tickets.test.ts does.
// ---------------------------------------------------------------------------

import {
  authorize,
  canApprove,
  canApproveAtGate,
  requiresHumanGate,
  isPrivilegedProposalKind,
  nextEscalationLevel,
  toEscalationLevel,
  tierForAction,
  HUMAN_GATE_ACTIONS,
} from '@/lib/support/roles';

describe('support authorize() — front-line actions', () => {
  const frontline = ['reply', 'resolve', 'assign', 'escalate'] as const;

  it('lets an L1 agent reply/resolve/assign/escalate directly', () => {
    for (const a of frontline) {
      expect(authorize('support_agent', a)).toBe('allow');
    }
  });

  it('lets a lead and a global_admin do the same', () => {
    for (const a of frontline) {
      expect(authorize('support_lead', a)).toBe('allow');
      expect(authorize('global_admin', a)).toBe('allow');
    }
  });

  it('denies everything to an unknown / undefined role', () => {
    expect(authorize(undefined, 'reply')).toBe('deny');
    expect(authorize('viewer', 'resolve')).toBe('deny');
  });
});

describe('support authorize() — refunds/credits/account changes force the gate', () => {
  it('NEVER returns allow for a money/account action, for any role', () => {
    for (const action of HUMAN_GATE_ACTIONS) {
      expect(authorize('support_agent', action)).not.toBe('allow');
      expect(authorize('support_lead', action)).not.toBe('allow');
      expect(authorize('global_admin', action)).not.toBe('allow');
    }
  });

  it('an L1 agent cannot even initiate a refund (deny)', () => {
    expect(authorize('support_agent', 'refund')).toBe('deny');
    expect(authorize('support_agent', 'credit')).toBe('deny');
    expect(authorize('support_agent', 'account_change')).toBe('deny');
  });

  it('a lead or admin may RAISE it to the human gate (gate, not allow)', () => {
    for (const action of HUMAN_GATE_ACTIONS) {
      expect(authorize('support_lead', action)).toBe('gate');
      expect(authorize('global_admin', action)).toBe('gate');
    }
  });

  it('requiresHumanGate / privileged-kind flags are consistent', () => {
    expect(requiresHumanGate('refund')).toBe(true);
    expect(requiresHumanGate('reply')).toBe(false);
    expect(isPrivilegedProposalKind('refund')).toBe(true);
    expect(isPrivilegedProposalKind('support')).toBe(false);
    expect(isPrivilegedProposalKind(undefined)).toBe(false);
  });
});

describe('who approves a refund vs a reply', () => {
  it('reply: any support role can approve directly', () => {
    expect(canApprove('support_agent', 'reply')).toBe(true);
    expect(canApprove('support_lead', 'reply')).toBe(true);
  });

  it('refund: NO support role can approve directly (goes to the gate)', () => {
    expect(canApprove('support_agent', 'refund')).toBe(false);
    expect(canApprove('support_lead', 'refund')).toBe(false);
    expect(canApprove('global_admin', 'refund')).toBe(false);
  });

  it('only a global_admin (the human) can approve AT the gate', () => {
    expect(canApproveAtGate('global_admin')).toBe(true);
    expect(canApproveAtGate('support_lead')).toBe(false);
    expect(canApproveAtGate('support_agent')).toBe(false);
    expect(canApproveAtGate(undefined)).toBe(false);
  });
});

describe('escalation ladder', () => {
  it('walks l1 → l2 → human then stops', () => {
    expect(nextEscalationLevel('l1')).toBe('l2');
    expect(nextEscalationLevel('l2')).toBe('human');
    expect(nextEscalationLevel('human')).toBeNull();
  });

  it('normalises arbitrary input to a valid level (default l1)', () => {
    expect(toEscalationLevel('l2')).toBe('l2');
    expect(toEscalationLevel('human')).toBe('human');
    expect(toEscalationLevel('nonsense')).toBe('l1');
    expect(toEscalationLevel(undefined)).toBe('l1');
  });

  it('routes money actions to the human rung, others to l1', () => {
    expect(tierForAction('refund')).toBe('human');
    expect(tierForAction('reply')).toBe('l1');
  });
});

// ---------------------------------------------------------------------------
// Part 2 — assignment data layer (lib/data.ts) with the DB mocked.
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const qReturns: any[][] = [];
  const q1Returns: any[] = [];
  const q = vi.fn(async () => (qReturns.length ? qReturns.shift() : []));
  const q1 = vi.fn(async () => (q1Returns.length ? q1Returns.shift() : null));
  return { state, qReturns, q1Returns, q, q1 };
});
const { qReturns, q1Returns, q, q1 } = H;

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
}));

import { assignTicket, getTicketsAssignedTo } from '@/lib/data';

beforeEach(() => {
  H.state.dbPresent = true;
  qReturns.length = 0;
  q1Returns.length = 0;
  q.mockClear();
  q1.mockClear();
});

const baseRow = { ref: 'REQ-0009', kind: 'request', title: 'T', status: 'open' };

describe('assignTicket', () => {
  it('sets the assignee column + mirrors attrs.assignee', async () => {
    q1Returns.push({ ...baseRow, assignee: 'sam', assigned_at: '2026-07-11T00:00:00Z', attrs: { assignee: 'sam' } });
    const { row } = await assignTicket('REQ-0009', 'sam');
    const [, params] = q1.mock.calls[q1.mock.calls.length - 1] as [string, any[]];
    expect(params).toEqual(['REQ-0009', 'sam']);
    expect(row?.assignee).toBe('sam');
    expect(row?.assignedAt).toBe('2026-07-11T00:00:00Z');
  });

  it('unassigns (passes null) when given "—" or empty', async () => {
    q1Returns.push({ ...baseRow, assignee: null, assigned_at: null, attrs: {} });
    await assignTicket('REQ-0009', '—');
    const [, params] = q1.mock.calls[q1.mock.calls.length - 1] as [string, any[]];
    expect(params).toEqual(['REQ-0009', null]);
  });

  it('throws with no DB', async () => {
    H.state.dbPresent = false;
    await expect(assignTicket('REQ-0009', 'sam')).rejects.toThrow(/no DB/);
  });
});

describe('getTicketsAssignedTo', () => {
  it('matches the column OR the attrs fallback for the given user', async () => {
    qReturns.push([
      { ...baseRow, assignee: 'sam', assigned_at: null, attrs: {} },
    ]);
    const { rows, live } = await getTicketsAssignedTo('sam');
    const [text, params] = q.mock.calls[q.mock.calls.length - 1] as [string, any[]];
    expect(text).toMatch(/assignee = \$1 or attrs->>'assignee' = \$1/);
    expect(params).toEqual(['sam']);
    expect(live).toBe(true);
    expect(rows[0].assignee).toBe('sam');
  });

  it('degrades (no query) when the id is empty', async () => {
    const { live } = await getTicketsAssignedTo('');
    expect(live).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
});
