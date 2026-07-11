-- Sentinel — P2 Multi-tenancy on tickets. Idempotent; runs after
-- 13_hermes_kb.sql. Additive to ops.tickets (all new columns nullable). Safe to
-- re-run.
--
-- WHY: tickets need to be attributable to a TENANT (a Clerk Organization) and a
-- customer contact so a per-tenant / Customer-360 view can scope to just that
-- tenant's records while operators (global_admin) still see everything.
--
-- ★ SHARED CONTRACT with the intake agent -----------------------------------
-- The intake path writes the same three values into ops.tickets.attrs (jsonb):
--   attrs.tenant_ref  · attrs.customer_email · attrs.customer_name
-- This migration promotes those to first-class columns AND backfills the
-- columns from attrs for any rows that already exist. Going forward, new writes
-- (lib/data.ts createTicket) set BOTH the columns and attrs so the contract
-- holds from either side; reads in lib/data.ts fall back to attrs when a column
-- is null (read-through), so rows written by intake-only are still tenant-scoped.

-- 1. Additive tenant columns ----------------------------------------------
alter table ops.tickets add column if not exists tenant_ref     text;  -- Clerk org id (= ops.orgs.id)
alter table ops.tickets add column if not exists customer_email text;
alter table ops.tickets add column if not exists customer_name  text;

-- 2. Backfill the columns from attrs (the shared contract) -----------------
-- Only touch rows where the column is still null but attrs carries the value,
-- so a re-run (or a row that already set the column) is a no-op.
update ops.tickets
   set tenant_ref = attrs->>'tenant_ref'
 where tenant_ref is null
   and attrs ? 'tenant_ref'
   and nullif(attrs->>'tenant_ref', '') is not null;

update ops.tickets
   set customer_email = attrs->>'customer_email'
 where customer_email is null
   and attrs ? 'customer_email'
   and nullif(attrs->>'customer_email', '') is not null;

update ops.tickets
   set customer_name = attrs->>'customer_name'
 where customer_name is null
   and attrs ? 'customer_name'
   and nullif(attrs->>'customer_name', '') is not null;

-- 3. Indexes for the two lookup axes (tenant scoping + customer match) ------
create index if not exists tickets_tenant_ref_idx    on ops.tickets (tenant_ref)     where tenant_ref     is not null;
create index if not exists tickets_customer_email_idx on ops.tickets (customer_email) where customer_email is not null;

-- 4. RLS — keep ops.tickets deny-all-by-policy off (cloud-clone guard). ------
-- ops.tickets already appears in 05_disable_ops_rls.sql; the new columns don't
-- change that. No table-level action needed here.
