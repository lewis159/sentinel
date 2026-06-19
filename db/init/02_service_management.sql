-- Sentinel — Service Management (ITIL) foundation. Idempotent; runs after
-- 01_schema.sql. Extends ops.tickets into the unified ITIL record and adds the
-- Delivery tables (roadmap + changelog). Safe to re-run.

-- 1. Extend ops.tickets into the unified ITIL record ----------------------
-- `kind` is the ITIL practice (incident|request|change|problem|release). The
-- legacy `type` column (task/security/infra) is kept untouched for back-compat.
alter table ops.tickets add column if not exists kind     text not null default 'incident';
alter table ops.tickets add column if not exists impact   text;        -- high|medium|low
alter table ops.tickets add column if not exists urgency  text;        -- high|medium|low
alter table ops.tickets add column if not exists priority_calc text;   -- reserved: derived impact×urgency
alter table ops.tickets add column if not exists app      text;        -- YT|Sentinel|Bruce|Estate
alter table ops.tickets add column if not exists sla_due  timestamptz; -- distinct from legacy sla_due_at
-- type-specific fields: change → risk/cab_status/window/backout;
-- problem → root_cause/known_error/workaround; release → version/window.
alter table ops.tickets add column if not exists attrs    jsonb not null default '{}';

create index if not exists tickets_kind_idx on ops.tickets (kind, status);
create index if not exists tickets_app_idx  on ops.tickets (app);
create index if not exists tickets_sla_idx  on ops.tickets (sla_due) where sla_due is not null;

-- 2. Roadmap items (Delivery → Roadmap board) -----------------------------
-- The roadmap is the home for project work; agent-writable; feeds the changelog
-- on ship. Columns: Backlog → In progress → In review → Shipped.
create table if not exists ops.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  item_key    text unique not null,
  title       text not null,
  description text,
  status      text not null default 'backlog', -- backlog|in_progress|in_review|shipped
  app         text,                            -- YT|Sentinel|Bruce|Estate
  sort_order  int  not null default 0,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_roadmap_updated on ops.roadmap_items;
create trigger trg_roadmap_updated before update on ops.roadmap_items
  for each row execute function ops.set_updated_at();
create index if not exists roadmap_status_idx on ops.roadmap_items (status, sort_order);
create index if not exists roadmap_app_idx     on ops.roadmap_items (app);

-- 3. Changelog entries (Delivery → Changelog) -----------------------------
-- Written when a roadmap item ships; agent-writable.
create table if not exists ops.changelog_entries (
  id uuid primary key default gen_random_uuid(),
  version  text,
  label    text not null,
  date     timestamptz not null default now(),
  body     text,
  app      text,                               -- YT|Sentinel|Bruce|Estate
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists changelog_date_idx on ops.changelog_entries (date desc);
create index if not exists changelog_app_idx   on ops.changelog_entries (app);
