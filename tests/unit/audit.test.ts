import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hash-chained audit log (lib/hermes/audit.ts). Two surfaces:
//   * append/hash — the pure computeRowHash + the no-DB appendAudit path.
//   * verifyChain — feeds a canned set of rows through the mocked q() and asserts
//     a well-formed chain verifies, and a tampered row is caught.
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const qReturns: any[][] = [];
  const q1Returns: any[] = [];
  const q = vi.fn(async (_text: string, _params?: any[]) =>
    qReturns.length ? qReturns.shift() : [],
  );
  const q1 = vi.fn(async (_text: string, _params?: any[]) =>
    q1Returns.length ? q1Returns.shift() : null,
  );
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

import { appendAudit, verifyChain, computeRowHash } from '@/lib/hermes/audit';

beforeEach(() => {
  H.state.dbPresent = true;
  qReturns.length = 0;
  q1Returns.length = 0;
  q.mockClear();
  q1.mockClear();
});

// Build a valid DB-shaped chain row using the library's own hash function, so
// verifyChain recomputes the identical hash.
function chainRow(
  seq: number,
  prevHash: string | null,
  fields: {
    ts: string;
    actor: string | null;
    action: string;
    proposalId: string | null;
    tenantRef: string | null;
    tool: string | null;
    summary: string | null;
    detail: Record<string, unknown>;
  },
) {
  const row_hash = computeRowHash(prevHash, fields);
  return {
    seq,
    ts: fields.ts,
    actor: fields.actor,
    action: fields.action,
    proposal_id: fields.proposalId,
    tenant_ref: fields.tenantRef,
    tool: fields.tool,
    summary: fields.summary,
    detail: fields.detail,
    prev_hash: prevHash,
    row_hash,
  };
}

describe('computeRowHash', () => {
  it('is deterministic and links to prev_hash', () => {
    const f = {
      ts: '2026-07-11T00:00:00.000Z',
      actor: 'system',
      action: 'proposal.created',
      proposalId: 'p1',
      tenantRef: null,
      tool: null,
      summary: 'created',
      detail: { a: 1, b: 2 },
    };
    const h1 = computeRowHash(null, f);
    const h1b = computeRowHash(null, { ...f, detail: { b: 2, a: 1 } }); // key order flipped
    expect(h1).toBe(h1b); // stable key ordering
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // Changing prev_hash changes the row hash → the chain binds rows together.
    expect(computeRowHash('deadbeef', f)).not.toBe(h1);
  });
});

describe('appendAudit (no DB)', () => {
  it('returns a coherent genesis row with a computed hash and does not query', async () => {
    H.state.dbPresent = false;
    const row = await appendAudit({ action: 'proposal.created', actor: 'system', proposalId: 'p1' });
    expect(row.prevHash).toBeNull();
    expect(row.rowHash).toMatch(/^[0-9a-f]{64}$/);
    expect(q1).not.toHaveBeenCalled();
  });
});

describe('appendAudit (with DB)', () => {
  it('reads the tail for prev_hash and INSERTs with the computed row_hash', async () => {
    q1Returns.push({ row_hash: 'PREVHASH' });            // tail lookup
    q1Returns.push({ seq: 5, id: 'a5', ts: '2026-07-11T00:00:00.000Z' }); // insert returning
    const row = await appendAudit({ action: 'proposal.executed', actor: 'op', tool: 'refund' });
    expect(row.prevHash).toBe('PREVHASH');
    // The INSERT must persist the SAME row_hash we returned.
    const insertCall = q1.mock.calls.find(([sql]) => /insert into ops\.hermes_audit_log/i.test(sql)) as [string, any[]];
    const params = insertCall[1];
    expect(params[params.length - 1]).toBe(row.rowHash); // row_hash is the last bound param
    expect(params[params.length - 2]).toBe('PREVHASH');  // prev_hash before it
  });
});

describe('verifyChain', () => {
  const base = (action: string, seq: number) => ({
    ts: `2026-07-11T0${seq}:00:00.000Z`,
    actor: 'system',
    action,
    proposalId: `p${seq}`,
    tenantRef: null,
    tool: null,
    summary: `s${seq}`,
    detail: { n: seq },
  });

  it('verifies a well-formed chain', async () => {
    const r1 = chainRow(1, null, base('proposal.created', 1));
    const r2 = chainRow(2, r1.row_hash, base('proposal.approved', 2));
    const r3 = chainRow(3, r2.row_hash, base('proposal.executed', 3));
    qReturns.push([r1, r2, r3]);
    const v = await verifyChain();
    expect(v.ok).toBe(true);
    expect(v.count).toBe(3);
    expect(v.brokenAtSeq).toBeNull();
  });

  it('catches a tampered row (row_hash no longer matches contents)', async () => {
    const r1 = chainRow(1, null, base('proposal.created', 1));
    const r2 = chainRow(2, r1.row_hash, base('proposal.approved', 2));
    // Someone edits r2's summary AFTER the fact but leaves the stored hash.
    const tampered = { ...r2, summary: 'EDITED' };
    qReturns.push([r1, tampered]);
    const v = await verifyChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAtSeq).toBe(2);
    expect(v.reason).toMatch(/row_hash/i);
  });

  it('catches a broken link (prev_hash does not point at the prior row)', async () => {
    const r1 = chainRow(1, null, base('proposal.created', 1));
    // r2 was recomputed against the wrong prev (a deleted middle row scenario).
    const r2 = chainRow(2, 'WRONGPREV', base('proposal.approved', 2));
    qReturns.push([r1, r2]);
    const v = await verifyChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAtSeq).toBe(2);
    expect(v.reason).toMatch(/prev_hash/i);
  });

  it('empty chain (no DB) is valid', async () => {
    H.state.dbPresent = false;
    const v = await verifyChain();
    expect(v.ok).toBe(true);
    expect(v.count).toBe(0);
  });
});
