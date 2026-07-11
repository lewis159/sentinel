import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// P2 multi-tenancy coverage for the ticket data layer + tenant resolution.
//
// lib/data.ts is DB-backed (imports { hasDb, q, q1 } from './db'). There is no
// live Postgres in unit tests, so we mock '@/lib/db' the way autonomy.test.ts
// does: hasDb is forced true (to exercise the SQL path) and q/q1 are spies that
// (a) capture the SQL text + bound params so we can assert on them, and
// (b) return canned rows so read-through mapping runs.
// ---------------------------------------------------------------------------

// Hoisted so the vi.mock factory (itself hoisted to the top of the module) can
// close over them — top-level test-scope consts are NOT visible to the factory.
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

import { getTicketsByKind, createTicket } from '@/lib/data';

beforeEach(() => {
  H.state.dbPresent = true;
  qReturns.length = 0;
  q1Returns.length = 0;
  q.mockClear();
  q1.mockClear();
});

// Convenience: the (text, params) the pg mock was last called with.
const lastQ = () => q.mock.calls[q.mock.calls.length - 1] as [string, any[]];

// ---------------------------------------------------------------------------
// mapServiceTicket read-through — exercised through getTicketsByKind, which
// maps every DB row via the (module-private) mapServiceTicket. Feeding a row
// through q() and reading the mapped ServiceTicket back is the cleanest way to
// assert the read-through without exporting a private helper.
// ---------------------------------------------------------------------------
describe('mapServiceTicket read-through (via getTicketsByKind)', () => {
  const baseRow = {
    ref: 'REQ-0001',
    kind: 'request',
    title: 'T',
    status: 'open',
  };

  it('prefers the real column when present (all three fields)', async () => {
    qReturns.push([
      {
        ...baseRow,
        tenant_ref: 'org_col',
        customer_email: 'col@x.com',
        customer_name: 'Col Name',
        attrs: { tenant_ref: 'org_attr', customer_email: 'attr@x.com', customer_name: 'Attr Name' },
      },
    ]);
    const { rows } = await getTicketsByKind('request');
    expect(rows[0].tenantRef).toBe('org_col');
    expect(rows[0].customerEmail).toBe('col@x.com');
    expect(rows[0].customerName).toBe('Col Name');
  });

  it('falls back to attrs.* when the column is null (all three fields)', async () => {
    qReturns.push([
      {
        ...baseRow,
        tenant_ref: null,
        customer_email: null,
        customer_name: null,
        attrs: { tenant_ref: 'org_attr', customer_email: 'attr@x.com', customer_name: 'Attr Name' },
      },
    ]);
    const { rows } = await getTicketsByKind('request');
    expect(rows[0].tenantRef).toBe('org_attr');
    expect(rows[0].customerEmail).toBe('attr@x.com');
    expect(rows[0].customerName).toBe('Attr Name');
  });

  it('resolves to null when both column and attrs are absent (all three fields)', async () => {
    qReturns.push([{ ...baseRow, tenant_ref: null, customer_email: null, customer_name: null, attrs: {} }]);
    const { rows } = await getTicketsByKind('request');
    expect(rows[0].tenantRef).toBeNull();
    expect(rows[0].customerEmail).toBeNull();
    expect(rows[0].customerName).toBeNull();
  });

  it('parses a stringified attrs column before falling back', async () => {
    qReturns.push([
      {
        ...baseRow,
        tenant_ref: null,
        customer_email: null,
        customer_name: null,
        attrs: JSON.stringify({ tenant_ref: 'org_str', customer_email: 's@x.com', customer_name: 'Str' }),
      },
    ]);
    const { rows } = await getTicketsByKind('request');
    expect(rows[0].tenantRef).toBe('org_str');
    expect(rows[0].customerEmail).toBe('s@x.com');
    expect(rows[0].customerName).toBe('Str');
  });
});

// ---------------------------------------------------------------------------
// getTicketsByKind — tenant scoping predicate.
// ---------------------------------------------------------------------------
describe('getTicketsByKind tenant scoping', () => {
  it('no tenantRef arg → unscoped operator SQL (no tenant_ref predicate)', async () => {
    qReturns.push([{ ref: 'INC-1', kind: 'incident', title: 'x', status: 'open', attrs: {} }]);
    await getTicketsByKind('incident');
    const [sql, params] = lastQ();
    expect(sql).not.toMatch(/tenant_ref\s*=/i);
    expect(sql).toMatch(/where kind=\$1/i);
    expect(params).toEqual(['incident']);
  });

  it('non-empty tenantRef → adds "and tenant_ref=$N" and binds the value', async () => {
    qReturns.push([{ ref: 'INC-1', kind: 'incident', title: 'x', status: 'open', attrs: {} }]);
    await getTicketsByKind('incident', { tenantRef: 'org_acme' });
    const [sql, params] = lastQ();
    expect(sql).toMatch(/and tenant_ref=\$2/i);
    expect(params).toEqual(['incident', 'org_acme']);
  });

  it('empty-string tenantRef → treated as unscoped (does NOT inject an empty filter)', async () => {
    qReturns.push([{ ref: 'INC-1', kind: 'incident', title: 'x', status: 'open', attrs: {} }]);
    await getTicketsByKind('incident', { tenantRef: '' });
    const [sql, params] = lastQ();
    expect(sql).not.toMatch(/tenant_ref\s*=/i);
    expect(params).toEqual(['incident']);
  });

  it('undefined tenantRef in opts → treated as unscoped', async () => {
    qReturns.push([{ ref: 'INC-1', kind: 'incident', title: 'x', status: 'open', attrs: {} }]);
    await getTicketsByKind('incident', { tenantRef: undefined });
    const [sql, params] = lastQ();
    expect(sql).not.toMatch(/tenant_ref\s*=/i);
    expect(params).toEqual(['incident']);
  });
});

// ---------------------------------------------------------------------------
// getTicketsByKind — zero-rows vs no-DB (the tenant-isolation invariant).
//
// The mock fallback (fabricated ticket rows) must fire ONLY when the query
// could not run (no DB / connection error), NEVER when a real query returned
// zero rows. A tenant-scoped call must never surface mock rows at all — so a
// tenant with genuinely no tickets can never be shown another/fake tenant's
// data. `live` must stay accurate: real-but-empty = live:true.
//
// Discriminator: mock.serviceTickets contains 3 'incident' rows (INC-0001..3),
// so if the fallback were (wrongly) firing, an 'incident' read would return a
// non-empty, live:false result. The correct behaviour is [] with live:true.
// ---------------------------------------------------------------------------
describe('getTicketsByKind zero-rows vs no-DB (tenant isolation)', () => {
  it('(a) DB present + zero rows, unscoped → [] with live:true (NOT mock rows)', async () => {
    // qReturns is empty ⇒ the pg mock resolves []. hasDb is true (beforeEach).
    const res = await getTicketsByKind('incident');
    expect(res.live).toBe(true);
    expect(res.rows).toEqual([]);
  });

  it('(b) DB present + zero rows, tenantRef-scoped → [] with live:true (NOT mock rows)', async () => {
    const res = await getTicketsByKind('incident', { tenantRef: 'org_empty' });
    // The scoped predicate was still applied to the real query...
    const [sql, params] = lastQ();
    expect(sql).toMatch(/and tenant_ref=\$2/i);
    expect(params).toEqual(['incident', 'org_empty']);
    // ...and an empty real result is real-empty, not a mock fallback.
    expect(res.live).toBe(true);
    expect(res.rows).toEqual([]);
  });

  it('scoped call never falls back to mock when the DB is absent', async () => {
    H.state.dbPresent = false;
    const res = await getTicketsByKind('incident', { tenantRef: 'org_x' });
    expect(res.rows).toEqual([]);
    expect(res.live).toBe(false);
    // The pg layer must not even be consulted with no DB.
    expect(q).not.toHaveBeenCalled();
  });

  it('scoped call never falls back to mock when the query errors', async () => {
    H.q.mockImplementationOnce(async () => {
      throw new Error('connection refused');
    });
    const res = await getTicketsByKind('incident', { tenantRef: 'org_x' });
    expect(res.rows).toEqual([]);
    expect(res.live).toBe(false);
  });

  it('unscoped call KEEPS the mock fallback when the DB is absent (dev DX preserved)', async () => {
    H.state.dbPresent = false;
    const res = await getTicketsByKind('incident');
    expect(res.live).toBe(false);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.every((t) => t.kind === 'incident')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createTicket — dual-write: first-class columns AND mirrored into attrs.
// q1 is called twice: (1) mint the ref, (2) the INSERT. We capture the INSERT
// call to assert on the persisted columns + attrs mirror.
// ---------------------------------------------------------------------------
describe('createTicket dual-write of tenant fields', () => {
  const insertCall = () =>
    q1.mock.calls.find(([sql]) => /insert into ops\.tickets/i.test(sql)) as [string, any[]];

  it('writes tenant fields to columns AND mirrors them into attrs', async () => {
    q1Returns.push({ ref: 'REQ-0007' }); // next_ticket_ref()
    q1Returns.push({ ref: 'REQ-0007' }); // insert ... returning ref

    const res = await createTicket({
      kind: 'request',
      title: 'Need help',
      tenantRef: 'org_acme',
      customerEmail: 'jane@acme.com',
      customerName: 'Jane Acme',
    });
    expect(res.ref).toBe('REQ-0007');

    const [, params] = insertCall();
    // Column bindings: ...tenant_ref=$12, customer_email=$13, customer_name=$14, attrs=$15
    expect(params[11]).toBe('org_acme');
    expect(params[12]).toBe('jane@acme.com');
    expect(params[13]).toBe('Jane Acme');

    // attrs is the last bound param, stringified JSON — the intake-side mirror.
    const attrs = JSON.parse(params[14]);
    expect(attrs.tenant_ref).toBe('org_acme');
    expect(attrs.customer_email).toBe('jane@acme.com');
    expect(attrs.customer_name).toBe('Jane Acme');
  });

  it('leaves attrs mirror keys absent when tenant fields are not supplied', async () => {
    q1Returns.push({ ref: 'INC-0002' });
    q1Returns.push({ ref: 'INC-0002' });

    await createTicket({ kind: 'incident', title: 'No tenant' });

    const [, params] = insertCall();
    expect(params[11]).toBeNull(); // tenant_ref column
    expect(params[12]).toBeNull(); // customer_email column
    expect(params[13]).toBeNull(); // customer_name column
    const attrs = JSON.parse(params[14]);
    expect(attrs).not.toHaveProperty('tenant_ref');
    expect(attrs).not.toHaveProperty('customer_email');
    expect(attrs).not.toHaveProperty('customer_name');
  });

  it('preserves caller-supplied attrs alongside the tenant mirror', async () => {
    q1Returns.push({ ref: 'REQ-0009' });
    q1Returns.push({ ref: 'REQ-0009' });

    await createTicket({
      kind: 'request',
      title: 'With attrs',
      tenantRef: 'org_x',
      attrs: { assignee: 'bob' },
    });

    const [, params] = insertCall();
    const attrs = JSON.parse(params[14]);
    expect(attrs.assignee).toBe('bob');
    expect(attrs.tenant_ref).toBe('org_x');
  });
});
