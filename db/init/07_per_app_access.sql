-- Sentinel — Per-App Access Model (Phase 1). Idempotent; runs after
-- 04_user_access.sql. Additive to the `ops` schema. Safe to re-run.
--
-- Design (decided architecture): access is now PER-APP rather than a single flat
-- none/viewer/admin grant. Source of truth is split by app:
--   * Sentinel & Bruce  → owned by `ops` (this DB) — Sentinel writes directly.
--   * YT (tier/credits)  → owned by YT's own DB; Sentinel is READ-THROUGH DISPLAY
--                          only (cached in ops.app_entitlements). YT writes happen
--                          via the YT admin API in Phase 2 — NOT from here.
--   * Clerk publicMetadata.apps remains a MIRROR/CACHE the estate apps read.
--
-- GRANTS: matching 02/04/06 — these files contain NO explicit GRANT statements.
-- The `sentinel_app` role is provisioned with ops-schema privileges out-of-band
-- (see 05_disable_ops_rls.sql), so any new ops.* table created here is reachable
-- by sentinel_app under the same schema-level grant. No per-table GRANT needed.

-- 1. Extend ops.user_app_access with per-app role + org + source ----------
-- `app_role`  : per-app role (currently used by Sentinel: viewer|responder|admin).
--               Coexists with access_level (none|viewer|admin) which the estate
--               apps still read. NULL = fall back to access_level semantics.
-- `org_id`    : optional Clerk Organization the grant is scoped to (mirror only).
-- `source`    : which system owns/authored the row ('sentinel'|'bruce'|'yt').
alter table ops.user_app_access add column if not exists app_role text;
alter table ops.user_app_access add column if not exists org_id   text;
alter table ops.user_app_access add column if not exists source   text not null default 'sentinel';

-- Keep app_role's set documented + enforced but extensible (drop & re-add so a
-- re-run picks up new roles if this file is edited). NULL is always allowed.
alter table ops.user_app_access drop constraint if exists user_app_access_role_chk;
alter table ops.user_app_access
  add constraint user_app_access_role_chk
  check (app_role is null or app_role in ('viewer', 'responder', 'admin'));

-- 2. App entitlements — read-through DISPLAY cache for app-owned state -----
-- Holds tier/quota/add-ons pulled on-demand from an app's own DB (Phase 1: only
-- YT). Sentinel never authors these values; it only caches the last sync. A row
-- absent (or synced_at null) means "not synced yet" and the UI says so.
create table if not exists ops.app_entitlements (
  clerk_user_id text not null,
  app           text not null,                  -- 'yt' | ...
  tier          text,                           -- e.g. 'free' | 'pro' | 'enterprise'
  quota_limit   int,                            -- period allowance (e.g. 100)
  quota_used    int,                            -- consumed this period (e.g. 47)
  quota_period  text,                           -- e.g. 'month'
  addons        jsonb not null default '{}',    -- feature add-ons / credit packs
  external_ref  text,                           -- id in the owning app's DB
  synced_at     timestamptz,                    -- last successful pull (null = never)
  updated_at    timestamptz not null default now(),
  primary key (clerk_user_id, app)
);

create index if not exists app_entitlements_app_idx on ops.app_entitlements (app);

drop trigger if exists trg_app_entitlements_updated on ops.app_entitlements;
create trigger trg_app_entitlements_updated before update on ops.app_entitlements
  for each row execute function ops.set_updated_at();

-- 3. Orgs — mirror of Clerk Organizations --------------------------------
-- Clerk is the source of truth for org membership; these tables are a local
-- mirror for joins/reporting. Phase 1 is READ-ONLY in the UI.
create table if not exists ops.orgs (
  id         text primary key,                  -- Clerk organization id
  name       text,
  source     text not null default 'clerk',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_orgs_updated on ops.orgs;
create trigger trg_orgs_updated before update on ops.orgs
  for each row execute function ops.set_updated_at();

create table if not exists ops.org_members (
  org_id        text not null,
  clerk_user_id text not null,
  org_role      text,                           -- Clerk org role (e.g. 'admin'|'basic_member')
  added_by      text,                           -- actor clerk_user_id
  created_at    timestamptz not null default now(),
  primary key (org_id, clerk_user_id)
);

create index if not exists org_members_user_idx on ops.org_members (clerk_user_id);

-- 4. RLS — keep ops.* deny-all-by-policy off for the new tables -----------
-- Same rationale as 05_disable_ops_rls.sql: a cloud-cloned schema may arrive
-- with RLS enabled and no policies (deny-all for sentinel_app). Disable it for
-- the tables added here. No-op when RLS is already off.
do $$
declare t text;
begin
  foreach t in array array['app_entitlements','orgs','org_members'] loop
    if to_regclass('ops.'||t) is not null then
      execute format('alter table ops.%I disable row level security', t);
    end if;
  end loop;
end $$;
