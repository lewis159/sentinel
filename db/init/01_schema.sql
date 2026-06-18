-- Sentinel local database — runs once on first Postgres container start
-- (mounted into /docker-entrypoint-initdb.d). Self-contained: no dependency
-- on YT's public.users (user references are plain nullable uuids now).

create schema if not exists ops;

create or replace function ops.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create sequence if not exists ops.finding_seq start 1;
create sequence if not exists ops.ticket_seq  start 1;

-- Components ---------------------------------------------------------------
create table if not exists ops.components (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  kind text not null default 'service',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Findings ----------------------------------------------------------------
create table if not exists ops.findings (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  fingerprint text unique not null,
  title text not null,
  description text,
  severity text not null default 'medium',
  cvss numeric(3,1),
  cwe text,
  component_id uuid references ops.components(id) on delete set null,
  component_label text,
  source text not null default 'manual',
  status text not null default 'open',
  evidence jsonb not null default '{}',
  remediation jsonb not null default '{}',
  auto_managed boolean not null default true,
  override_locked boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function ops.set_finding_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null then new.ref := 'SEC-' || lpad(nextval('ops.finding_seq')::text, 4, '0'); end if;
  return new;
end; $$;
drop trigger if exists trg_finding_ref on ops.findings;
create trigger trg_finding_ref before insert on ops.findings for each row execute function ops.set_finding_ref();
drop trigger if exists trg_finding_updated on ops.findings;
create trigger trg_finding_updated before update on ops.findings for each row execute function ops.set_updated_at();
create index if not exists findings_status_idx on ops.findings (status, severity);
create index if not exists findings_source_idx on ops.findings (source, last_seen_at desc);

-- Tickets (no FK to external users — plain nullable uuids) -----------------
create table if not exists ops.tickets (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  description text,
  type text not null default 'task',
  status text not null default 'open',
  priority text not null default 'medium',
  assignee_user_id uuid,
  reporter_user_id uuid,
  source text not null default 'manual',
  sla_due_at timestamptz,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function ops.set_ticket_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null then new.ref := 'OPS-' || lpad(nextval('ops.ticket_seq')::text, 4, '0'); end if;
  return new;
end; $$;
drop trigger if exists trg_ticket_ref on ops.tickets;
create trigger trg_ticket_ref before insert on ops.tickets for each row execute function ops.set_ticket_ref();
drop trigger if exists trg_ticket_updated on ops.tickets;
create trigger trg_ticket_updated before update on ops.tickets for each row execute function ops.set_updated_at();
create index if not exists tickets_status_idx on ops.tickets (status, priority);
create index if not exists tickets_type_idx on ops.tickets (type, status);

-- Comments ----------------------------------------------------------------
create table if not exists ops.comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references ops.tickets(id) on delete cascade,
  author_user_id uuid,
  body text,
  kind text not null default 'comment',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists comments_ticket_idx on ops.comments (ticket_id, created_at);

-- Links (graph) -----------------------------------------------------------
create table if not exists ops.links (
  id uuid primary key default gen_random_uuid(),
  src_type text not null, src_id text not null,
  dst_type text not null, dst_id text not null,
  relation text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (src_type, src_id, dst_type, dst_id, relation)
);
create index if not exists links_src_idx on ops.links (src_type, src_id);
create index if not exists links_dst_idx on ops.links (dst_type, dst_id);

-- Container snapshots -----------------------------------------------------
create table if not exists ops.container_snapshots (
  id uuid primary key default gen_random_uuid(),
  component_id uuid references ops.components(id) on delete set null,
  container_name text not null,
  state text, cpu_pct numeric(5,2), mem_bytes bigint, mem_limit_bytes bigint, restarts int,
  taken_at timestamptz not null default now(),
  raw jsonb not null default '{}'
);
create index if not exists snapshots_name_time_idx on ops.container_snapshots (container_name, taken_at desc);

-- Rules / alerts ----------------------------------------------------------
create table if not exists ops.rules (
  id uuid primary key default gen_random_uuid(),
  name text not null, enabled boolean not null default true,
  trigger jsonb not null default '{}', action jsonb not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists ops.alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references ops.rules(id) on delete set null,
  severity text not null default 'medium', message text not null,
  dedup_key text, status text not null default 'firing',
  fired_at timestamptz not null default now(), resolved_at timestamptz,
  metadata jsonb not null default '{}'
);
create index if not exists alerts_dedup_idx on ops.alerts (dedup_key, status);

-- Jobs queue — durable job queue for the scalable worker pool (HA) ---------
create table if not exists ops.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued', -- queued|running|done|error
  locked_by text,
  locked_at timestamptz,
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists jobs_status_run_after_idx on ops.jobs (status, run_after);
-- Prevent duplicate pending periodic jobs of the same type (scheduler relies
-- on this for ON CONFLICT DO NOTHING idempotent enqueue across N workers).
create unique index if not exists jobs_one_pending_per_type on ops.jobs (type) where status in ('queued','running');

-- Connectors — configurable external data sources (e.g. Supabase → YT) -----
create table if not exists public.connectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,                 -- 'supabase'
  config jsonb not null default '{}',  -- { url, key }
  enabled boolean not null default true,
  status text not null default 'unconfigured',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Resilience / self-test run history (written by scripts/resilience-check.sh) ---
create table if not exists ops.resilience_runs (
  id uuid primary key default gen_random_uuid(),
  suite text not null,                 -- db-failover | app-replica | worker | headers | scale | all
  passed boolean not null,
  results jsonb not null default '{}',  -- { check: {passed, detail} }
  duration_ms int,
  ran_at timestamptz not null default now()
);
create index if not exists resilience_runs_time_idx on ops.resilience_runs (ran_at desc);
