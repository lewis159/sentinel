import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { NODB, hasDbUrl, SKIP_MESSAGE, runSqlFile, DATABASE_URL } from './_helpers';

// ---------------------------------------------------------------------------
// RLS — tenant isolation on ops.tickets, enforced by REAL row-level security.
//
// This suite APPLIES migration 17 (enable + force RLS) itself, turns the flag
// HERMES_RLS_ENABLED on to SEED via the real withTenantRls() operator path, then
// asserts what the Postgres policy hermes_tickets_tenant_isolation actually
// returns:
//   * operator identity (app.is_operator='on')       → sees ALL rows.
//   * tenant identity   (app.tenant_ref='<org>')      → sees ONLY that tenant.
//   * no identity       (is_operator='off', ref='')   → sees ZERO rows (fail-closed).
//
// WHY A DEDICATED NON-SUPERUSER ROLE
// ---------------------------------------------------------------------------
// PostgreSQL SUPERUSERS bypass RLS unconditionally — even ALTER TABLE … FORCE
// ROW LEVEL SECURITY does not scope them (FORCE only makes the policy apply to a
// NON-superuser table OWNER). In CI the app connects as POSTGRES_USER=sentinel,
// which is a superuser, so a query issued on the normal pool connection would
// see EVERY row and the isolation assertions would be meaningless (they were
// previously failing: expected 2, got 3; expected 0, got 3).
//
// In production the app connects as the non-superuser `sentinel_app` role, so
// RLS genuinely applies. To reproduce that here we create a throwaway
// non-superuser role `rls_probe`, then run each isolation assertion inside a
// transaction that does SET LOCAL ROLE rls_probe TOGETHER WITH the request-local
// GUCs (app.is_operator / app.tenant_ref), and count ops.tickets directly. This
// runs the query with RLS actually enforced, proving the policy — not the
// superuser bypass — is what filters the rows.
//
// Cleanup DISABLES RLS again and drops the probe role so the shared DB is left
// as the other suites expect.
// ---------------------------------------------------------------------------

import { withTenantRls } from '@/lib/data';
import { q } from '@/lib/db';

const ORG_A = 'itest_rls_A';
const ORG_B = 'itest_rls_B';

// Match lib/db.ts / _helpers.ts TLS handling for the direct probe client.
const ssl = process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false };

// A dedicated non-superuser client used to run assertions as `rls_probe`. Opened
// in beforeAll, closed in afterAll. Distinct from the app's superuser pool.
let probe: Client;

type Identity = { tenantRef: string | null; isOperator: boolean } | null;

// Count ops.tickets AS the non-superuser rls_probe role, with the given request
// identity applied via SET LOCAL GUCs — exactly the shape lib/db.ts sets in prod.
// Everything is transaction-local (SET LOCAL / set_config is_local=true), so each
// call starts from a clean slate and nothing leaks between assertions.
async function countAsProbe(identity: Identity, orgs: string[]): Promise<number> {
  await probe.query('begin');
  try {
    if (identity) {
      await probe.query(`select set_config('app.is_operator', $1, true)`, [
        identity.isOperator ? 'on' : 'off',
      ]);
      await probe.query(`select set_config('app.tenant_ref', $1, true)`, [
        identity.tenantRef ?? '',
      ]);
    }
    // Drop to the non-superuser role so RLS is actually enforced on the SELECT.
    await probe.query('set local role rls_probe');
    const res = await probe.query<{ c: number }>(
      `select count(*)::int as c from ops.tickets where tenant_ref = any($1)`,
      [orgs],
    );
    return res.rows[0]?.c ?? 0;
  } finally {
    await probe.query('rollback');
  }
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

    // Create the throwaway non-superuser probe role and grant it just enough to
    // SELECT ops.tickets. Idempotent so re-runs on the shared DB don't error.
    await q(`do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'rls_probe') then
          create role rls_probe nologin;
        end if;
      end $$`);
    await q('grant usage on schema ops to rls_probe');
    await q('grant select on ops.tickets to rls_probe');

    // Open the dedicated client and confirm it can assume the role.
    probe = new Client({ connectionString: DATABASE_URL, ssl });
    await probe.connect();

    // Seed under an operator identity (WITH CHECK requires the GUC to pass now
    // that RLS is forced). 2 tickets for tenant A, 1 for tenant B. This runs on
    // the app's superuser pool via withTenantRls, which is fine for WRITES —
    // superuser bypass lets the seed insert; the READ assertions below are what
    // must be scoped, and those run as rls_probe.
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
      // Close the probe client, drop its grants + role, then disable RLS again.
      try {
        if (probe) await probe.end();
      } catch {
        /* ignore — best-effort cleanup */
      }
      try {
        // drop owned by removes the grants so drop role can succeed.
        await q('drop owned by rls_probe');
        await q('drop role if exists rls_probe');
      } catch {
        /* ignore — role may already be gone on a re-run */
      }
      await q('alter table ops.tickets disable row level security');
      delete process.env.HERMES_RLS_ENABLED;
    }
  });

  it('operator identity sees ALL seeded tickets', async () => {
    const n = await countAsProbe({ tenantRef: null, isOperator: true }, [ORG_A, ORG_B]);
    expect(n).toBe(3);
  });

  it('tenant A sees ONLY its own tickets', async () => {
    const both = await countAsProbe({ tenantRef: ORG_A, isOperator: false }, [ORG_A, ORG_B]);
    expect(both).toBe(2); // the two A rows; B is invisible

    const bOnly = await countAsProbe({ tenantRef: ORG_A, isOperator: false }, [ORG_B]);
    expect(bOnly).toBe(0); // cannot see another tenant's rows
  });

  it('tenant B sees ONLY its own tickets', async () => {
    const n = await countAsProbe({ tenantRef: ORG_B, isOperator: false }, [ORG_A, ORG_B]);
    expect(n).toBe(1); // the single B row; both A rows invisible
  });

  it('no identity is fail-closed — ZERO rows', async () => {
    // No GUCs set at all: current_setting('app.tenant_ref', true) → NULL, so the
    // policy's `tenant_ref = NULL` matches no row and is_operator defaults 'off'.
    const n = await countAsProbe(null, [ORG_A, ORG_B]);
    expect(n).toBe(0);
  });
});
