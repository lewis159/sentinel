import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// P3 — flag-gated tenant RLS enablement (lib/data.ts withTenantRls +
// lib/db.ts withDbTransaction).
//
// We exercise the REAL lib/db.ts (so the actual SET LOCAL / set_config SQL is
// issued) by mocking the `pg` module: our fake Pool hands out a fake client
// whose .query records every statement. Identity comes from a mocked
// getSessionTenant. No live DB.
//
// DATABASE_URL is set in vi.hoisted (runs before the hoisted imports) so
// lib/db.ts sees hasDb === true and builds its pool from our mocked Pool.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  // Fresh env + a clean pool cache so lib/db.ts builds OUR mocked pool.
  process.env.DATABASE_URL = 'postgres://test/sentinel';
  process.env.PGSSL = 'disable';
  delete process.env.HERMES_RLS_ENABLED;
  // @ts-expect-error — test-only reset of the module-cached pool singleton.
  delete globalThis._sentinelPool;

  const clientQueries: Array<{ text: string; params?: any[] }> = [];
  const baseClientQuery = async (text: string, params?: any[]) => {
    clientQueries.push({ text, params });
    return { rows: [] as any[] };
  };
  // Text-aware variant: returns a ref row for ref-minting / RETURNING statements
  // so write paths (createTicket) resolve cleanly instead of throwing on empty rows.
  const refAwareClientQuery = async (text: string, params?: any[]) => {
    clientQueries.push({ text, params });
    if (/returning ref|next_ticket_ref/i.test(text)) return { rows: [{ ref: 'INC-0001' }] as any[] };
    return { rows: [] as any[] };
  };
  const client = { query: vi.fn(baseClientQuery), release: vi.fn() };
  const basePoolQuery = async (_text: string, _params?: any[]) => ({ rows: [] as any[] });
  const refAwarePoolQuery = async (text: string, _params?: any[]) => {
    if (/returning ref|next_ticket_ref/i.test(text)) return { rows: [{ ref: 'INC-0001' }] as any[] };
    return { rows: [] as any[] };
  };
  const pool = { connect: vi.fn(async () => client), query: vi.fn(basePoolQuery) };
  const sessionTenant = vi.fn(async () => ({ tenantRef: null as string | null, isOperator: true }));
  return {
    clientQueries, client, pool, sessionTenant,
    baseClientQuery, refAwareClientQuery, basePoolQuery, refAwarePoolQuery,
  };
});

vi.mock('pg', () => ({ Pool: vi.fn(() => H.pool) }));
vi.mock('@/lib/auth', () => ({ getSessionTenant: H.sessionTenant }));

import {
  getTicketsByKind,
  getCustomer360,
  getRecentTickets,
  createTicket,
  withTenantRls,
} from '@/lib/data';

// set_config statements the transaction issued, as [name, value] pairs.
const setConfigParams = () =>
  H.clientQueries
    .filter((c) => /set_config/i.test(c.text))
    .map((c) => c.params as [string, string]);

const texts = () => H.clientQueries.map((c) => c.text.toLowerCase());

beforeEach(() => {
  H.clientQueries.length = 0;
  H.client.query.mockClear();
  H.client.release.mockClear();
  H.pool.connect.mockClear();
  H.pool.query.mockClear();
  H.sessionTenant.mockReset();
  H.sessionTenant.mockResolvedValue({ tenantRef: null, isOperator: true });
  delete process.env.HERMES_RLS_ENABLED;
});

afterEach(() => {
  // Restore canonical mock implementations (write tests swap in ref-aware ones).
  H.client.query.mockImplementation(H.baseClientQuery);
  H.pool.query.mockImplementation(H.basePoolQuery);
});

afterAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.PGSSL;
  delete process.env.HERMES_RLS_ENABLED;
});

// ---------------------------------------------------------------------------
// Flag ON — GUCs are set inside a transaction with the right values.
// ---------------------------------------------------------------------------
describe('withTenantRls flag ON — per-request GUCs', () => {
  it('operator session sets app.is_operator=on (and NO tenant_ref)', async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    H.sessionTenant.mockResolvedValue({ tenantRef: null, isOperator: true });

    await getTicketsByKind('incident');

    const cfg = setConfigParams();
    expect(cfg).toContainEqual(['app.is_operator', 'on']);
    expect(cfg.some(([name]) => name === 'app.tenant_ref')).toBe(false);
    // Ran inside a transaction on a pinned client (pool-safe), not pool.query.
    expect(H.pool.connect).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('begin');
    expect(texts()).toContain('commit');
    expect(H.client.release).toHaveBeenCalledTimes(1);
  });

  it('tenant session sets is_operator=off + app.tenant_ref=<org id>', async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    H.sessionTenant.mockResolvedValue({ tenantRef: 'org_acme', isOperator: false });

    await getTicketsByKind('incident', { tenantRef: 'org_acme' });

    const cfg = setConfigParams();
    expect(cfg).toContainEqual(['app.is_operator', 'off']);
    expect(cfg).toContainEqual(['app.tenant_ref', 'org_acme']);
  });

  it('uses SET LOCAL scope (set_config is_local=true) — pool-safe, no leak', async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    H.sessionTenant.mockResolvedValue({ tenantRef: 'org_acme', isOperator: false });

    await getTicketsByKind('incident', { tenantRef: 'org_acme' });

    // The GUC is written with the local (3rd arg true) flag, so COMMIT discards
    // it and a recycled pooled connection can never carry it to a later request.
    const setConfigStmts = H.clientQueries.filter((c) => /set_config/i.test(c.text));
    expect(setConfigStmts.length).toBeGreaterThan(0);
    expect(setConfigStmts.every((c) => /,\s*true\s*\)/.test(c.text))).toBe(true);
  });

  it('getCustomer360 also runs under the operator GUC transaction', async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    H.sessionTenant.mockResolvedValue({ tenantRef: null, isOperator: true });

    await getCustomer360('org_x');

    expect(setConfigParams()).toContainEqual(['app.is_operator', 'on']);
    expect(H.pool.connect).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('commit');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed — identity cannot be resolved ⇒ non-operator, empty tenant.
// ---------------------------------------------------------------------------
describe('withTenantRls fail-closed', () => {
  it('getSessionTenant throwing ⇒ is_operator=off + tenant_ref="" (0 rows once RLS on)', async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    H.sessionTenant.mockRejectedValue(new Error('no request context'));

    await getTicketsByKind('incident');

    const cfg = setConfigParams();
    expect(cfg).toContainEqual(['app.is_operator', 'off']);
    expect(cfg).toContainEqual(['app.tenant_ref', '']);
  });

  it('explicit identity override is honoured without consulting getSessionTenant', async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    H.sessionTenant.mockRejectedValue(new Error('should not be called'));

    await withTenantRls(async () => 'ok', { tenantRef: null, isOperator: true });

    expect(H.sessionTenant).not.toHaveBeenCalled();
    expect(setConfigParams()).toContainEqual(['app.is_operator', 'on']);
  });
});

// ---------------------------------------------------------------------------
// Flag OFF — behaviour identical to today: no transaction, no GUCs, no identity.
// ---------------------------------------------------------------------------
describe('withTenantRls flag OFF — unchanged behaviour', () => {
  it('issues NO GUC statements and never opens a transaction', async () => {
    // HERMES_RLS_ENABLED unset (beforeEach).
    await getTicketsByKind('incident');

    expect(H.pool.connect).not.toHaveBeenCalled();
    expect(setConfigParams()).toEqual([]);
    // The read still ran — through the plain shared pool, as before.
    expect(H.pool.query).toHaveBeenCalled();
  });

  it('does NOT resolve identity (getSessionTenant untouched) when flag is off', async () => {
    await getTicketsByKind('incident', { tenantRef: 'org_acme' });
    expect(H.sessionTenant).not.toHaveBeenCalled();
  });

  it('withTenantRls is a pure pass-through when the flag is off', async () => {
    const out = await withTenantRls(async () => 42);
    expect(out).toBe(42);
    expect(H.pool.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Newly-wrapped operator ops.tickets paths. These are trusted server/service
// surfaces that pass an explicit OPERATOR_IDENTITY, so they resolve to
// app.is_operator='on' (ALL rows) and NEVER consult getSessionTenant — the
// bot/service/no-Clerk paths would otherwise fail-closed to 0 rows under RLS.
// ---------------------------------------------------------------------------
describe('wrapped operator paths — read (getRecentTickets)', () => {
  it('flag ON: sets app.is_operator=on, runs the query in a tx, no session lookup', async () => {
    process.env.HERMES_RLS_ENABLED = '1';

    await getRecentTickets(new Date().toISOString(), 10);

    const cfg = setConfigParams();
    expect(cfg).toContainEqual(['app.is_operator', 'on']);
    // Operator override → never sets a tenant_ref, never consults getSessionTenant.
    expect(cfg.some(([name]) => name === 'app.tenant_ref')).toBe(false);
    expect(H.sessionTenant).not.toHaveBeenCalled();
    // Ran inside the pinned transaction and the SELECT actually executed.
    expect(H.pool.connect).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('begin');
    expect(texts()).toContain('commit');
    expect(texts().some((t) => /from ops\.tickets/.test(t))).toBe(true);
  });

  it('flag OFF: no GUCs, no transaction — unchanged behaviour', async () => {
    await getRecentTickets(new Date().toISOString(), 10);

    expect(setConfigParams()).toEqual([]);
    expect(H.pool.connect).not.toHaveBeenCalled();
    expect(H.pool.query).toHaveBeenCalled();
    expect(H.sessionTenant).not.toHaveBeenCalled();
  });
});

describe('wrapped operator paths — write (createTicket)', () => {
  it('flag ON: sets app.is_operator=on and the INSERT runs inside the tx', async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    H.client.query.mockImplementation(H.refAwareClientQuery);

    const res = await createTicket({ kind: 'incident', title: 'RLS smoke' });
    expect(res.ref).toBe('INC-0001');

    const cfg = setConfigParams();
    expect(cfg).toContainEqual(['app.is_operator', 'on']);
    expect(H.sessionTenant).not.toHaveBeenCalled();
    expect(H.pool.connect).toHaveBeenCalledTimes(1);
    expect(texts()).toContain('begin');
    expect(texts()).toContain('commit');
    expect(texts().some((t) => /insert into ops\.tickets/.test(t))).toBe(true);
  });

  it('flag OFF: no GUCs, no transaction, INSERT still runs on the pool — unchanged', async () => {
    H.pool.query.mockImplementation(H.refAwarePoolQuery);

    const res = await createTicket({ kind: 'incident', title: 'RLS smoke' });
    expect(res.ref).toBe('INC-0001');

    expect(setConfigParams()).toEqual([]);
    expect(H.pool.connect).not.toHaveBeenCalled();
    expect(H.pool.query).toHaveBeenCalled();
    expect(H.sessionTenant).not.toHaveBeenCalled();
  });
});
