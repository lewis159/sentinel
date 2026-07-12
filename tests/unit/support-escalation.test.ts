import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P3 — escalation ladder + human-gate routing (lib/support/data.ts).
//
// This module is server-only and depends on the DB plus two collaborators:
//   - addTicketComment (@/lib/data)            → timeline note
//   - saveProposal     (@/lib/hermes/proposals) → raise to the human gate
// We stub 'server-only', mock the DB, and spy on both collaborators so we can
// assert escalation bumps priority/records history, and that a refund is raised
// to the gate carrying a PRIVILEGED proposal kind (never executed here).
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const qReturns: any[][] = [];
  const q1Returns: any[] = [];
  const q = vi.fn(async () => (qReturns.length ? qReturns.shift() : []));
  const q1 = vi.fn(async () => (q1Returns.length ? q1Returns.shift() : null));
  const addTicketComment = vi.fn(async () => null);
  const saveProposal = vi.fn(async () => 'prop-1');
  return { state, qReturns, q1Returns, q, q1, addTicketComment, saveProposal };
});

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
}));
vi.mock('@/lib/data', () => ({ addTicketComment: H.addTicketComment }));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: H.saveProposal }));

import {
  escalateTicket,
  raiseHumanGateProposal,
  getSupportStaff,
} from '@/lib/support/data';

beforeEach(() => {
  H.state.dbPresent = true;
  H.qReturns.length = 0;
  H.q1Returns.length = 0;
  H.q.mockClear();
  H.q1.mockClear();
  H.addTicketComment.mockClear();
  H.saveProposal.mockClear();
});

describe('escalateTicket', () => {
  it('bumps one rung (l1 → l2), bumps priority, and records history', async () => {
    // 1st q1: current ticket row; 2nd q1: the inserted escalation id.
    H.q1Returns.push({ priority: 'medium', attrs: { escalation_level: 'l1' } });
    H.q1Returns.push({ id: 'esc-1' });

    const res = await escalateTicket('INC-1', undefined, 'front line stuck', 'sam');

    expect(res.ok).toBe(true);
    expect(res.level).toBe('l2');
    expect(res.id).toBe('esc-1');

    // The UPDATE bound the bumped priority (medium → high) + target level.
    const update = H.q.mock.calls.find((c) => /update ops\.tickets/i.test(c[0]));
    expect(update?.[1]).toEqual(['INC-1', 'high', 'l2']);

    // History insert captured who/why/from/to.
    const insert = H.q1.mock.calls.find((c) => /insert into ops\.ticket_escalations/i.test(c[0]));
    expect(insert?.[1]).toEqual(['INC-1', 'l1', 'l2', 'front line stuck', 'sam']);

    // A timeline note was written.
    expect(H.addTicketComment).toHaveBeenCalledOnce();
  });

  it('honours an explicit target level (jump straight to human)', async () => {
    H.q1Returns.push({ priority: 'high', attrs: {} });
    H.q1Returns.push({ id: 'esc-2' });
    const res = await escalateTicket('INC-2', 'human', 'needs Ben', 'lead1');
    expect(res.level).toBe('human');
    const update = H.q.mock.calls.find((c) => /update ops\.tickets/i.test(c[0]));
    expect(update?.[1]).toEqual(['INC-2', 'critical', 'human']);
  });

  it('returns not-found when the ticket does not resolve', async () => {
    H.q1Returns.push(null);
    const res = await escalateTicket('NOPE', undefined, '', 'sam');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it('no-ops with no DB', async () => {
    H.state.dbPresent = false;
    const res = await escalateTicket('INC-1', undefined, '', 'sam');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no database/);
  });
});

describe('raiseHumanGateProposal — refunds go to the gate, never execute', () => {
  it('saves a proposal carrying the privileged kind (=action) and escalates to human', async () => {
    // escalateTicket (called inside) needs a ticket row + insert id.
    H.q1Returns.push({ priority: 'medium', attrs: {} }); // escalate: current row
    H.q1Returns.push({ id: 'esc-3' }); // escalate: history insert

    const id = await raiseHumanGateProposal({
      ref: 'REQ-9',
      action: 'refund',
      title: 'refund on REQ-9',
      summary: 'customer wants £18 back',
      by: 'lead1',
    });

    expect(id).toBe('prop-1');
    expect(H.saveProposal).toHaveBeenCalledOnce();
    const arg = H.saveProposal.mock.calls[0][0] as any;
    // The proposal kind IS the money action → the approve gate will demand a
    // global_admin. No tool/action was executed here.
    expect(arg.kind).toBe('refund');
    expect(arg.ref).toBe('REQ-9');
    expect(arg.proposal?.action).toBeUndefined();
  });
});

describe('getSupportStaff', () => {
  it('falls back to a non-empty roster with no DB (dropdown never empty)', async () => {
    H.state.dbPresent = false;
    const staff = await getSupportStaff();
    expect(staff.length).toBeGreaterThan(0);
    expect(staff.some((s) => s.tier === 'lead')).toBe(true);
  });

  it('maps DB rows (leads first) when present', async () => {
    H.qReturns.push([
      { clerk_user_id: 'ben', display_name: 'Ben Percival', tier: 'lead', active: true },
      { clerk_user_id: 'sam', display_name: 'Sam Okafor', tier: 'agent', active: true },
    ]);
    const staff = await getSupportStaff();
    expect(staff[0].tier).toBe('lead');
    expect(staff[1].clerkUserId).toBe('sam');
  });
});
