import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NODB, hasDbUrl, SKIP_MESSAGE, runSqlFile } from './_helpers';

// ---------------------------------------------------------------------------
// RLS — tenant isolation on ops.tickets, enforced by REAL row-level security.
//
// This suite APPLIES migration 17 (enable + force RLS) itself, turns the flag
// HERMES_RLS_ENABLED on, then drives the real lib/data.ts withTenantRls() wrapper
// (→ lib/db.ts withDbTransaction → SET LOCAL GUCs) and asserts what the Postgres
// policy hermes_tickets_tenant_isolation actually returns:
//   * operator identity (app.is_operator='on')       → sees ALL rows.
//   * tenant identity   (app.tenant_ref='<org>')      → sees ONLY that tenant.
//   * no identity       (is_operator='off', ref='')   → sees ZERO rows (fail-closed).
//
// Cleanup DISABLES RLS again so the shared DB is left as the other suites expect.
// ---------------------------------------------------------------------------

import { withTenantRls } from '@/lib/data';
import { q } from '@/lib/db';

const ORG_A = 'itest_rls_A';
const ORG_B = 'itest_rls_B';

async function countIn(orgs: string[]): Promise<number> {
  const rows = await q<{ c: number }>(
    `select count(*)::int as c from ops.tickets where tenant_ref = any($1)`,
    [orgs],
  );
  return rows[0]?.c ?? 0;
}

if (NODB) {
  // eslint-disable-next-line no-console
  console.log(`[rls.test] ${SKIP_MESSAGE}`);
}

describe.runIf(NODB)('rls (skipped, no DATABASE_URL)', () => {
  it('no DB — skipped', () => {
    expect(hasDbUrl).toBe(false);
  });
});

describe.skipIf(NODB)('RLS: tenant isolation on ops.tickets (real policy)', () => {
  beforeAll(async () => {
    process.env.HERMES_RLS_ENABLED = '1';
    // Apply migration 17 for THIS suite (idempotent — enables + forces RLS).
    await runSqlFile('17_enable_tenant_rls.sql');

    // Seed under an operator identity (WITH CHECK requires the GUC to pass now
    // that RLS is forced). 2 tickets for tenant A, 1 for tenant B.
    await withTenantRls(async () => {
      await q(`delete from ops.tickets where tenant_ref = any($1)`, [[ORG_A, ORG_B]]);
      await q(`insert into ops.tickets (title, tenant_ref) values ($1, $2)`, ['A-1', ORG_A]);
      await q(`insert into ops.tickets (title, tenant_ref) values ($1, $2)`, ['A-2', ORG_A]);
      await q(`insert into ops.tickets (title, tenant_ref) values ($1, $2)`, ['B-1', ORG_B]);
    }, { tenantRef: null, isOperator: true });
  });

  afterAll(async () => {
    // Remove seeded rows (operator GUC) then turn RLS back off for other suites.
    try {
      await withTenantRls(async () => {
        await q(`delete from ops.tickets where tenant_ref = any($1)`, [[ORG_A, ORG_B]]);
      }, { tenantRef: null, isOperator: true });
    } finally {
      await q('alter table ops.tickets disable row level security');
      delete process.env.HERMES_RLS_ENABLED;
    }
  });

  it('operator identity sees ALL seeded tickets', async () => {
    const n = await withTenantRls(() => countIn([ORG_A, ORG_B]), { tenantRef: null, isOperator: true });
    expect(n).toBe(3);
  });

  it('tenant A sees ONLY its own tickets', async () => {
    const both = await withTenantRls(() => countIn([ORG_A, ORG_B]), { tenantRef: ORG_A, isOperator: false });
    expect(both).toBe(2); // the two A rows; B is invisible

    const bOnly = await withTenantRls(() => countIn([ORG_B]), { tenantRef: ORG_A, isOperator: false });
    expect(bOnly).toBe(0); // cannot see another tenant's rows
  });

  it('no identity is fail-closed — ZERO rows', async () => {
    const n = await withTenantRls(() => countIn([ORG_A, ORG_B]), { tenantRef: null, isOperator: false });
    expect(n).toBe(0);
  });
});
