-- Sentinel — User & App Access Management. Idempotent; runs after
-- 02_service_management.sql / 03_itil_ticket_refs.sql. Additive to the `ops`
-- schema. Safe to re-run. NOT applied live by this build — apply separately.
--
-- Design (RESEARCH.md, Approach D / Hybrid): this DB is the SOURCE OF TRUTH for
-- per-user, per-app access. Sentinel mirrors the resulting map into Clerk
-- `publicMetadata.apps` and records every change in an append-only audit table.

-- 1. Source of truth: per-user, per-app access level -----------------------
-- One row per (user, app). access_level is the coarse grant the estate apps
-- read from their session token. Extensible set: none | viewer | admin.
create table if not exists ops.user_app_access (
  clerk_user_id text not null,
  app           text not null,                  -- 'yt' | 'bruce' | 'sentinel' | ...
  access_level  text not null default 'none',   -- 'none' | 'viewer' | 'admin'
  granted_by    text,                           -- actor clerk_user_id (who changed it)
  ref           text,                           -- optional linked ticket ref (e.g. quota request)
  granted_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (clerk_user_id, app)
);

-- Keep the level set documented + enforced, but extensible: drop & re-add so a
-- re-run picks up new levels if this file is edited.
alter table ops.user_app_access drop constraint if exists user_app_access_level_chk;
alter table ops.user_app_access
  add constraint user_app_access_level_chk
  check (access_level in ('none', 'viewer', 'admin'));

create index if not exists user_app_access_user_idx on ops.user_app_access (clerk_user_id);
create index if not exists user_app_access_app_idx  on ops.user_app_access (app);

drop trigger if exists trg_user_app_access_updated on ops.user_app_access;
create trigger trg_user_app_access_updated before update on ops.user_app_access
  for each row execute function ops.set_updated_at();

-- 2. Append-only audit: who changed whose access to what, when -------------
-- `action` is the kind of change (e.g. 'set_access', 'quota_request'). `ref`
-- links to a service-request ticket where relevant (metered quota increases).
create table if not exists ops.access_audit (
  id            bigserial primary key,
  clerk_user_id text,                            -- target user the change is about
  app           text,
  action        text not null default 'set_access',
  old_value     text,
  new_value     text,
  actor         text,                            -- who performed the change
  ref           text,                            -- optional linked ticket ref
  created_at    timestamptz not null default now()
);

create index if not exists access_audit_user_idx    on ops.access_audit (clerk_user_id, created_at desc);
create index if not exists access_audit_created_idx  on ops.access_audit (created_at desc);
