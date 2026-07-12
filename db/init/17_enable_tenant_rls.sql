-- 17_enable_tenant_rls.sql — ENABLE tenant RLS on ops.tickets. GUARDED.
--
-- ⚠️  DO NOT RUN THIS UNTIL THE APP SETS THE PER-REQUEST GUCs ON EVERY
--     ops.tickets ACCESS PATH.  Running it early WILL break the operator
--     console (deny-all: RLS on + no GUC set = 0 rows for every query).
--
-- Companion to 15_hermes_p3_substrate.sql, which created the policy
-- `hermes_tickets_tenant_isolation` on ops.tickets but deliberately LEFT RLS
-- DISABLED (see also 05_disable_ops_rls.sql). This migration is the final,
-- separate, human-gated step that turns RLS ON. It is intentionally a distinct
-- file so it can be applied in a maintenance window, long after the app that
-- sets the GUCs has been deployed and verified.
--
-- ---------------------------------------------------------------------------
-- GO-LIVE ORDER (do these IN ORDER — do not skip step 3's verification):
--
--   1. Deploy the app with HERMES_RLS_ENABLED=1.
--        → The app now sets request-local GUCs on every wrapped read:
--            operator/global_admin → SET LOCAL app.is_operator = 'on'
--            tenant surface        → SET LOCAL app.is_operator = 'off'
--                                  + SET LOCAL app.tenant_ref  = '<clerk_org_id>'
--          via lib/data.ts withTenantRls() → lib/db.ts withDbTransaction().
--        → RLS is still OFF here, so results are UNCHANGED — this is a no-op on
--          behaviour and therefore zero-risk. Bake it in / soak it.
--
--   2. VERIFY the app sets the GUCs on EVERY ops.tickets path (see the
--      "WRAPPED PATHS" checklist below). Any unwrapped read/write will
--      fail-closed (reads → 0 rows; writes → WITH CHECK violation) the instant
--      step 3 runs. As of the RLS-wrapping follow-up, EVERY ops.tickets access
--      path in lib/ is now routed through the GUC path (lib/data.ts withTenantRls
--      → lib/db.ts withDbTransaction). Operator/service/console surfaces pass an
--      explicit OPERATOR_IDENTITY ({ isOperator: true, tenantRef: null }) so they
--      resolve to app.is_operator='on' (ALL rows) and never fail-closed. The
--      only tenant-scoped (customer-facing) reads are getTicketsByKind /
--      getCustomer360, which pass the caller's resolved tenant.
--
--   3. Run THIS migration (in a maintenance window). Then immediately verify:
--        * an operator session still sees ALL tickets, and
--        * a tenant session sees ONLY its own tenant_ref rows, and
--        * a session with no identity (fail-closed) sees ZERO rows.
--
--   4. ROLLBACK if anything regresses (instant, no data change):
--        alter table ops.tickets disable row level security;
--
-- ---------------------------------------------------------------------------
-- ops.tickets PATHS — ALL now wrapped (GUCs set on every access). Every entry
-- below passes the explicit OPERATOR_IDENTITY unless noted, because they are
-- trusted server-side operator/service/console surfaces (not customer-scoped):
--   reads : getTickets, getOneTicket, getServiceTicket, getRecentTickets
--           (Discord bot poll — SERVICE operator identity, NOT getSessionTenant),
--           getTicketsAssignedTo, findTicketByEmailMessageIds (email ingest —
--           service operator identity), getTicketComments, getGraph's
--           ops.tickets metadata read, createLink's nodeExists() ticket check,
--           and (lib/support/data.ts) getTicketsNeedingHuman, and
--           (lib/hermes/kb-index.ts) reindexKb + loadResolvedTicketText's
--           ops.tickets reads (wrapped per-read, not the whole reindex).
--   writes: createTicket, updateTicket, assignTicket, raiseTicketFromFinding,
--           createRelatedTicket, linkTicketToTicket, appendEmailMessageId
--           (email ingest — service operator identity), addTicketComment, and
--           (lib/support/data.ts) escalateTicket
--           (WITH CHECK on the policy applies to INSERT/UPDATE too).
--   tenant-scoped (NOT operator): getTicketsByKind, getCustomer360 pass the
--           caller's resolved tenant (getSessionTenant) — these are the only
--           customer-facing surfaces.
-- ---------------------------------------------------------------------------
--
-- Idempotent: ENABLE/FORCE are no-ops when already set, and the guard below
-- refuses to enable unless the policy from migration 15 is present (so we never
-- create a deny-all-with-no-policy state on a partially-migrated clone).

do $$
begin
  if to_regclass('ops.tickets') is null then
    raise notice 'ops.tickets does not exist — skipping RLS enable';
    return;
  end if;

  -- Guard: the isolation policy MUST already exist (created by migration 15).
  -- Without it, enabling RLS would deny-all every row. Refuse rather than break.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'ops'
       and tablename  = 'tickets'
       and policyname = 'hermes_tickets_tenant_isolation'
  ) then
    raise exception
      'Refusing to enable RLS on ops.tickets: policy hermes_tickets_tenant_isolation is missing. Apply 15_hermes_p3_substrate.sql first.';
  end if;

  -- Enable + FORCE row level security. FORCE also applies the policy to the
  -- table owner (so even a superuser-owned connection is scoped, not exempt).
  -- Both statements are idempotent — safe to re-run.
  execute 'alter table ops.tickets enable row level security';
  execute 'alter table ops.tickets force  row level security';

  raise notice 'RLS ENABLED + FORCED on ops.tickets (policy hermes_tickets_tenant_isolation active).';
end $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run manually if isolation regresses the console — instantaneous,
-- touches no data; the policy is left in place, just not enforced):
--
--   alter table ops.tickets disable row level security;
--   -- (FORCE is implied off once RLS is disabled; to also clear it explicitly:)
--   -- alter table ops.tickets no force row level security;
-- ---------------------------------------------------------------------------
