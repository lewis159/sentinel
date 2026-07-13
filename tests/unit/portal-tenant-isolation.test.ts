import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Customer portal — tenant-isolation + IDOR + field-whitelist invariants.
//
// These are THE tests that matter for this feature: they prove a customer can
// only ever see their own tenant's tickets, that a cross-tenant ref is a 404
// (null), and that operator-only columns never reach the customer DTO.
//
// lib/portal/tickets.ts is DB-backed (via '@/lib/db') and routes reads through
// withTenantRls (from '@/lib/data'). There is no live Postgres here, so we mock
// '@/lib/db' the way comment-visibility.test.ts does: hasDb forced, q/q1 spies
// that capture SQL text + bound params and return canned rows. HERMES_RLS_ENABLED
// is unset ⇒ withTenantRls is a pure pass-through, so the reads run our fn()
// directly against the mocked q/q1.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const state = { dbPresent: true };
  const qReturns: any[][] = [];
  const q1Returns: any[] = [];
  const q = vi.fn(async (_t: string, _p?: any[]) => (qReturns.length ? qReturns.shift() : []));
  const q1 = vi.fn(async (_t: string, _p?: any[]) => (q1Returns.length ? q1Returns.shift() : null));
  return { state, qReturns, q1Returns, q, q1 };
});
const { qReturns, q1Returns, q, q1 } = H;

vi.mock('@/lib/db', () => ({
  get hasDb() {
    return H.state.dbPresent;
  },
  q: H.q,
  q1: H.q1,
  // withTenantRls (in lib/data.ts) imports this but only calls it when the RLS
  // flag is ON; a stub keeps the import resolvable for the flag-OFF path.
  withDbTransaction: async (_s: any, fn: () => Promise<any>) => fn(),
}));

import {
  ticketBelongsToTenant,
  mapPortalTicket,
  listPortalTickets,
  getPortalTicket,
  type PortalTicket,
} from '@/lib/portal/tickets';

beforeEach(() => {
  H.state.dbPresent = true;
  qReturns.length = 0;
  q1Returns.length = 0;
  q.mockClear();
  q1.mockClear();
});

const lastQ = () => q.mock.calls[q.mock.calls.length - 1] as [string, any[]];
const lastQ1 = () => q1.mock.calls[q1.mock.calls.length - 1] as [string, any[]];

// A full ops.tickets row carrying operator-only fields, to prove the whitelist.
const rowFor = (tenant: string, ref = 'REQ-0001') => ({
  ref,
  kind: 'request',
  title: 'Need a Studio seat',
  status: 'open',
  priority: 'medium',
  opened_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  tenant_ref: tenant,
  // Operator-only noise that must NEVER survive into the DTO:
  assignee: 'ben',
  source: 'portal',
  customer_email: 'someone@acme.co',
  attrs: { internal_note: 'do not leak', escalation_level: 'human' },
});

// ---------------------------------------------------------------------------
// ticketBelongsToTenant — the pure IDOR gate.
// ---------------------------------------------------------------------------
describe('ticketBelongsToTenant', () => {
  it('true only when both are non-empty and exactly equal', () => {
    expect(ticketBelongsToTenant('acme', 'acme')).toBe(true);
  });
  it('false on a cross-tenant mismatch', () => {
    expect(ticketBelongsToTenant('acme', 'globex')).toBe(false);
  });
  it('false when the ticket has no tenant (unscoped/internal ticket)', () => {
    expect(ticketBelongsToTenant(null, 'acme')).toBe(false);
    expect(ticketBelongsToTenant('', 'acme')).toBe(false);
    expect(ticketBelongsToTenant('   ', 'acme')).toBe(false);
  });
  it('false when the caller has no tenant', () => {
    expect(ticketBelongsToTenant('acme', null)).toBe(false);
    expect(ticketBelongsToTenant('acme', '')).toBe(false);
  });
  it('does not match on whitespace/case-fuzzing (exact compare)', () => {
    expect(ticketBelongsToTenant('Acme', 'acme')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapPortalTicket — the field whitelist.
// ---------------------------------------------------------------------------
describe('mapPortalTicket whitelist', () => {
  it('copies only customer-safe fields and drops operator-only columns', () => {
    const dto = mapPortalTicket(rowFor('acme'));
    expect(dto).toEqual<PortalTicket>({
      ref: 'REQ-0001',
      subject: 'Need a Studio seat',
      status: 'open',
      kind: 'request',
      priority: 'medium',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
    const keys = Object.keys(dto);
    for (const leak of ['assignee', 'source', 'customer_email', 'attrs', 'tenant_ref', 'tenantRef']) {
      expect(keys).not.toContain(leak);
    }
  });
});

// ---------------------------------------------------------------------------
// listPortalTickets — tenant-scoped list.
// ---------------------------------------------------------------------------
describe('listPortalTickets tenant scoping', () => {
  it('filters the SQL by tenant_ref bound to the SESSION tenant', async () => {
    qReturns.push([rowFor('acme')]);
    const rows = await listPortalTickets('acme');
    const [sql, params] = lastQ();
    expect(sql).toMatch(/where\s+tenant_ref\s*=\s*\$1/i);
    expect(params).toEqual(['acme']);
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe('REQ-0001');
  });

  it('returns real-EMPTY (never mock) for a tenant with zero rows', async () => {
    qReturns.push([]); // DB reached, zero rows
    const rows = await listPortalTickets('lonelytenant');
    expect(rows).toEqual([]);
  });

  it('never queries and returns [] when the tenant is blank', async () => {
    const rows = await listPortalTickets('   ');
    expect(rows).toEqual([]);
    expect(q).not.toHaveBeenCalled();
  });

  it('returns [] (never mock) when there is no DB', async () => {
    H.state.dbPresent = false;
    const rows = await listPortalTickets('acme');
    expect(rows).toEqual([]);
  });

  it('returns [] (never mock) on a DB error', async () => {
    q.mockImplementationOnce(async () => {
      throw new Error('connection refused');
    });
    const rows = await listPortalTickets('acme');
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getPortalTicket — IDOR-safe single read.
// ---------------------------------------------------------------------------
describe('getPortalTicket IDOR safety', () => {
  it('scopes the SQL by BOTH ref AND tenant_ref', async () => {
    q1Returns.push(rowFor('acme', 'REQ-0007'));
    const t = await getPortalTicket('REQ-0007', 'acme');
    const [sql, params] = lastQ1();
    expect(sql).toMatch(/where\s+ref\s*=\s*\$1\s+and\s+tenant_ref\s*=\s*\$2/i);
    expect(params).toEqual(['REQ-0007', 'acme']);
    expect(t?.ref).toBe('REQ-0007');
  });

  it('returns null for an unknown ref (not found)', async () => {
    q1Returns.push(null);
    expect(await getPortalTicket('REQ-9999', 'acme')).toBeNull();
  });

  it('returns null (same as not-found) when a row leaks a different tenant_ref', async () => {
    // Belt-and-braces: even if the WHERE clause were bypassed and the DB handed
    // back a foreign-tenant row, the in-code re-check must reject it → null.
    q1Returns.push(rowFor('globex', 'REQ-0007'));
    expect(await getPortalTicket('REQ-0007', 'acme')).toBeNull();
  });

  it('returns null without querying when tenant or ref is blank', async () => {
    expect(await getPortalTicket('REQ-1', '')).toBeNull();
    expect(await getPortalTicket('', 'acme')).toBeNull();
    expect(q1).not.toHaveBeenCalled();
  });

  it('returns null (never mock) when there is no DB', async () => {
    H.state.dbPresent = false;
    expect(await getPortalTicket('REQ-1', 'acme')).toBeNull();
  });
});
