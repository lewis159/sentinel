-- 15_hermes_p3_substrate.sql — Hermes P3 SAFETY SUBSTRATE (schema half).
--
-- Four independent safety primitives that sit UNDER the Brain's action spine.
-- All four are ADDITIVE and UNWIRED by this migration — the libraries in
-- lib/hermes/{audit,exec-ledger,budget}.ts call them, and a later consolidation
-- pass hooks those libraries into lib/hermes/proposals.ts + brain/graph.ts (see
-- db/INTEGRATION.md). Nothing here changes existing tables or behaviour.
--
--   1. ops.hermes_audit_log        — immutable, hash-chained append-only log.
--   2. ops.hermes_tool_executions  — exactly-once execution ledger (UNIQUE key).
--   3. ops.hermes_budgets          — per (persona,tool,scope) spend caps.
--      ops.hermes_budget_ledger    — the spend rows the caps meter against.
--   4. Tenant RLS on ops.tickets   — GUC-driven, GUARDED (NOT auto-enabled).
--
-- Idempotent + additive. Lives in the `ops` schema alongside hermes_proposals
-- (10_hermes_proposals.sql). gen_random_uuid() matches the other ops.* tables.
-- Runs after 14_tenant_tickets.sql. Safe to re-run.

-- ===========================================================================
-- 1. IMMUTABLE AUDIT LOG — ops.hermes_audit_log
-- ===========================================================================
-- Append-only, hash-chained record of every safety-relevant Hermes event
-- (proposal created / approved / dismissed / executed). Each row carries a
-- row_hash = sha256(prev_hash || canonical(row)); prev_hash is the row_hash of
-- the immediately preceding row (by `seq`). Any retroactive edit or deletion
-- breaks the chain, which verifyChain() in lib/hermes/audit.ts detects.
--
-- The hash is computed APP-SIDE (lib/hermes/audit.ts) so the canonical byte
-- ordering is deterministic and identical to what verifyChain recomputes — DB
-- jsonb re-serialisation ordering is not relied upon.
--
-- `seq` (identity) gives a strict total order for the chain; `id` is the stable
-- external uuid. proposal_id is a soft FK to ops.hermes_proposals (nullable, set
-- null on delete) so the log outlives a proposal row.
create table if not exists ops.hermes_audit_log (
  seq         bigint generated always as identity primary key,
  id          uuid not null default gen_random_uuid() unique,
  ts          timestamptz not null default now(),
  actor       text,                        -- who/what triggered it (clerk id, persona, 'system')
  action      text not null                -- proposal.created|approved|dismissed|executed (+ extensible)
                check (action in (
                  'proposal.created', 'proposal.approved',
                  'proposal.dismissed', 'proposal.executed'
                )),
  proposal_id uuid references ops.hermes_proposals(id) on delete set null,
  tenant_ref  text,                         -- Clerk org id, when the event is tenant-scoped
  tool        text,                         -- tool name, for execute events
  summary     text,                         -- short human line
  detail      jsonb not null default '{}',  -- structured payload (args, result ref, etc.)
  prev_hash   text,                         -- row_hash of the prior row (null for the genesis row)
  row_hash    text not null                 -- sha256 hex over (prev_hash + canonical fields)
);

create index if not exists hermes_audit_log_ts_idx        on ops.hermes_audit_log (ts desc);
create index if not exists hermes_audit_log_proposal_idx  on ops.hermes_audit_log (proposal_id);
create index if not exists hermes_audit_log_action_idx    on ops.hermes_audit_log (action, ts desc);

-- --- DB-level append-only guard ------------------------------------------
-- (a) A trigger that hard-fails any UPDATE or DELETE. This is role-agnostic and
--     protects even a superuser-issued UPDATE from silently mutating history.
create or replace function ops.hermes_audit_no_mutate()
returns trigger language plpgsql as $$
begin
  raise exception 'ops.hermes_audit_log is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end; $$;

drop trigger if exists hermes_audit_log_no_update on ops.hermes_audit_log;
create trigger hermes_audit_log_no_update
  before update on ops.hermes_audit_log
  for each row execute function ops.hermes_audit_no_mutate();

drop trigger if exists hermes_audit_log_no_delete on ops.hermes_audit_log;
create trigger hermes_audit_log_no_delete
  before delete on ops.hermes_audit_log
  for each row execute function ops.hermes_audit_no_mutate();

-- (b) Belt-and-braces REVOKE so the app role can only INSERT/SELECT. PUBLIC
--     covers sentinel_app (which inherits ops privileges out-of-band, see
--     07_per_app_access.sql). Wrapped so a missing role never aborts the run.
do $$
begin
  revoke update, delete, truncate on ops.hermes_audit_log from public;
exception when others then
  -- privilege model differs across clones; the trigger is the real guard.
  null;
end $$;

-- ===========================================================================
-- 2. EXACTLY-ONCE EXECUTION LEDGER — ops.hermes_tool_executions
-- ===========================================================================
-- One row per intended side-effecting tool execution, keyed by a caller-chosen
-- idempotency_key that is UNIQUE NOT NULL. The claim is an
--   INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
-- so under any amount of concurrency EXACTLY ONE caller inserts (and gets a row
-- back); every duplicate conflicts and gets nothing back. That row-returned test
-- is the exactly-once gate: the winner runs the tool, losers stand down.
create table if not exists ops.hermes_tool_executions (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid references ops.hermes_proposals(id) on delete set null,
  tool            text not null,
  idempotency_key text not null unique,          -- the exactly-once gate
  status          text not null default 'claimed'
                    check (status in ('claimed', 'succeeded', 'failed')),
  result          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists hermes_tool_exec_proposal_idx on ops.hermes_tool_executions (proposal_id);
create index if not exists hermes_tool_exec_tool_idx     on ops.hermes_tool_executions (tool, created_at desc);

-- ===========================================================================
-- 3. BUDGET CAPS — ops.hermes_budgets + ops.hermes_budget_ledger
-- ===========================================================================
-- A cap is (persona, tool, scope) → cap_minor over a rolling window_seconds.
-- `tool = '*'` is a persona-wide cap across all tools; `scope` lets the same
-- persona/tool carry independent caps for different contexts (e.g. per-tenant),
-- default 'global'. cap_minor is in MINOR currency units (pennies) to match the
-- money-move tools; a non-money cap can reuse it as an integer counter.
create table if not exists ops.hermes_budgets (
  persona        text not null,
  tool           text not null default '*',      -- '*' = persona-wide (any tool)
  scope          text not null default 'global',
  cap_minor      bigint not null,                -- cap over the window, minor units
  window_seconds integer not null default 86400, -- rolling window (default 24h)
  updated_at     timestamptz not null default now(),
  updated_by     text,
  primary key (persona, tool, scope)
);

-- Every recorded spend that the caps meter against. Append-only in practice
-- (no guard trigger — spends may need administrative correction), summed within
-- the window by checkBudget().
create table if not exists ops.hermes_budget_ledger (
  id           uuid primary key default gen_random_uuid(),
  persona      text not null,
  tool         text not null default '*',
  scope        text not null default 'global',
  amount_minor bigint not null,
  proposal_id  uuid references ops.hermes_proposals(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists hermes_budget_ledger_lookup_idx
  on ops.hermes_budget_ledger (persona, tool, scope, created_at desc);

-- Seed conservative defaults (ON CONFLICT DO NOTHING keeps operator edits).
-- Persona-wide daily caps in pennies; tune via the governance settings page.
insert into ops.hermes_budgets (persona, tool, scope, cap_minor, window_seconds) values
  ('pa',      '*', 'global', 5000,  86400),   -- £50.00 / day across all tools
  ('billing', '*', 'global', 1500,  86400),   -- £15.00 / day (matches refund cap)
  ('support', '*', 'global', 1000,  86400)    -- £10.00 / day
on conflict (persona, tool, scope) do nothing;

-- ===========================================================================
-- 4. TENANT RLS ON ops.tickets — GUC-DRIVEN, GUARDED (NOT AUTO-ENABLED)
-- ===========================================================================
-- GOAL: a tenant-facing surface can never read another tenant's tickets, while
-- operator surfaces (global_admin) keep full-estate read. 05_disable_ops_rls.sql
-- deliberately keeps RLS OFF on ops.* because the operator console runs unscoped
-- queries as sentinel_app — so enabling RLS naively would BREAK every operator
-- read (deny-all with no matching policy).
--
-- Therefore the POLICIES are created here but RLS is LEFT DISABLED. Enabling is a
-- DELIBERATE, per-request-GUC-gated step documented in db/INTEGRATION.md. The
-- policy reads two request-local GUCs the app must SET before every query once
-- RLS is on:
--   app.is_operator = 'on'   → operator/global_admin: see ALL rows.
--   app.tenant_ref  = '<id>' → tenant surface: see ONLY tenant_ref = that id.
-- With neither GUC set (current state), and RLS off, nothing changes.
--
-- current_setting(..., true) → NULL instead of erroring when the GUC is unset,
-- so an operator query that forgets the GUC returns NO rows (fail-closed) rather
-- than leaking — but ONLY once someone enables RLS.
--
-- Drop-then-create so a re-run (or an edit to the predicate) is idempotent —
-- Postgres has no CREATE POLICY IF NOT EXISTS. The policy is inert while RLS is
-- disabled, so dropping/recreating it never affects live reads.
drop policy if exists hermes_tickets_tenant_isolation on ops.tickets;
create policy hermes_tickets_tenant_isolation on ops.tickets
  for all
  using (
    coalesce(current_setting('app.is_operator', true), 'off') = 'on'
    or tenant_ref = current_setting('app.tenant_ref', true)
  )
  with check (
    coalesce(current_setting('app.is_operator', true), 'off') = 'on'
    or tenant_ref = current_setting('app.tenant_ref', true)
  );

-- NOTE: intentionally NO `alter table ops.tickets enable row level security`.
-- RLS stays OFF until an operator runs the enable step in INTEGRATION.md after
-- the app is confirmed to set the GUCs on every request. The policy above is
-- inert while RLS is disabled.
