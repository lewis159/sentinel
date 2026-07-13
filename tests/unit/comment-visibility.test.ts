import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Comment internal/external visibility — data-layer contract (migration 24).
//
// lib/data.ts is DB-backed (imports { hasDb, q, q1 } from './db'). There is no
// live Postgres in unit tests, so we mock '@/lib/db' the same way
// tenant-tickets.test.ts does: hasDb forced true, and q/q1 are spies that
// capture the SQL text + bound params and return canned rows.
//
// The invariants under test:
//   * getTicketComments({ externalOnly:true }) filters to visibility='external'
//     at the SQL level (the customer-safe read); default reads ALL comments.
//   * addTicketComment defaults the persisted visibility to 'internal' (fail-safe)
//     and honours an explicit 'external'; any other value collapses to internal.
//   * the read mapping surfaces visibility, normalising anything != 'external'
//     to 'internal'.
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

import { getTicketComments, addTicketComment } from '@/lib/data';

beforeEach(() => {
  H.state.dbPresent = true;
  qReturns.length = 0;
  q1Returns.length = 0;
  q.mockClear();
  q1.mockClear();
});

// The (text, params) the read spy (q) was last called with.
const lastQ = () => q.mock.calls[q.mock.calls.length - 1] as [string, any[]];
// The INSERT call to q1 (skips the ref→id lookup call).
const insertCall = () =>
  q1.mock.calls.find(([sql]) => /insert into ops\.comments/i.test(sql)) as [string, any[]];

// ---------------------------------------------------------------------------
// getTicketComments — the externalOnly gate.
// ---------------------------------------------------------------------------
describe('getTicketComments visibility gate', () => {
  const mixed = [
    { id: '1', body: 'customer msg', kind: 'customer', visibility: 'external', metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    { id: '2', body: 'operator note', kind: 'update', visibility: 'internal', metadata: {}, created_at: '2026-01-01T00:01:00Z' },
    { id: '3', body: 'ai reply', kind: 'ai-reply', visibility: 'external', metadata: {}, created_at: '2026-01-01T00:02:00Z' },
  ];

  it('default read returns ALL comments and injects NO visibility predicate', async () => {
    q1Returns.push({ id: 'tk1' }); // ref→id
    qReturns.push(mixed);
    const rows = await getTicketComments('OPS-0001');
    const [sql] = lastQ();
    expect(sql).not.toMatch(/visibility\s*=/i);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.visibility)).toEqual(['external', 'internal', 'external']);
  });

  it('externalOnly:true adds the SQL predicate AND surfaces only external rows', async () => {
    q1Returns.push({ id: 'tk1' }); // ref→id
    // The DB does the filtering — model that by feeding back only external rows.
    qReturns.push(mixed.filter((r) => r.visibility === 'external'));
    const rows = await getTicketComments('OPS-0001', { externalOnly: true });
    const [sql] = lastQ();
    expect(sql).toMatch(/and visibility='external'/i);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.visibility === 'external')).toBe(true);
  });

  it('read mapping normalises a null/unknown visibility to internal (fail-safe)', async () => {
    q1Returns.push({ id: 'tk1' });
    qReturns.push([
      { id: '9', body: 'legacy', kind: 'comment', visibility: null, metadata: {}, created_at: '2026-01-01T00:00:00Z' },
      { id: '10', body: 'weird', kind: 'comment', visibility: 'bogus', metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    ]);
    const rows = await getTicketComments('OPS-0001');
    expect(rows.map((r) => r.visibility)).toEqual(['internal', 'internal']);
  });
});

// ---------------------------------------------------------------------------
// addTicketComment — default-internal, honours explicit external.
// ---------------------------------------------------------------------------
describe('addTicketComment visibility default', () => {
  // q1 is called twice: (1) ref→id lookup, (2) the INSERT ... returning.
  function primeInsert(returnedVisibility: string) {
    q1Returns.push({ id: 'tk1' }); // ref→id
    q1Returns.push({
      id: 'c1', body: 'x', kind: 'update', visibility: returnedVisibility,
      metadata: JSON.stringify({ author: 'Ben' }), created_at: '2026-01-01T00:00:00Z',
    });
  }

  it('defaults the persisted visibility to internal when none is passed', async () => {
    primeInsert('internal');
    const c = await addTicketComment('OPS-0001', 'hello', 'Ben');
    const [sql, params] = insertCall();
    expect(sql).toMatch(/insert into ops\.comments/i);
    expect(sql).toMatch(/visibility/i);
    // Column order: ticket_id, author_user_id(null implicit), body, kind, visibility, metadata
    expect(params[3]).toBe('internal'); // visibility bind ($4)
    expect(c?.visibility).toBe('internal');
  });

  it('honours an explicit external visibility', async () => {
    primeInsert('external');
    const c = await addTicketComment('OPS-0001', 'sent to customer', 'Hermes · Support', 'ai-reply', 'external');
    const [, params] = insertCall();
    expect(params[3]).toBe('external');
    expect(c?.visibility).toBe('external');
  });

  it('collapses an unexpected visibility value to internal before persisting', async () => {
    primeInsert('internal');
    // @ts-expect-error — deliberately passing an invalid value to prove normalisation.
    await addTicketComment('OPS-0001', 'x', 'Ben', 'update', 'public');
    const [, params] = insertCall();
    expect(params[3]).toBe('internal');
  });
});
