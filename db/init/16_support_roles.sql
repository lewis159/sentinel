-- Sentinel — P3 Support team roles, ticket assignment & escalation ladder.
-- Idempotent; runs after 14_tenant_tickets.sql (15 is reserved for another
-- agent). Everything here is ADDITIVE — new nullable columns + two new tables,
-- so an existing estate upgrades in place and a re-run is a no-op.
--
-- WHY: today Ben is the only human on the approval/support gate. This lets
-- support staff slot in: tickets gain an OWNER (assignee), and an escalation
-- ladder (L1 agent → L2 lead → human gate) is recorded per ticket. Refunds /
-- credits / account changes are NEVER executed here — they always route to the
-- existing Hermes proposals human gate (see lib/support/roles.ts + the approve
-- route), so this migration only records ownership and escalation history.

-- 1. Ticket ownership — first-class assignee columns (ADDITIVE) --------------
-- ops.tickets already carries assignee_user_id (uuid) but the data layer stores
-- the assignee as a TEXT label/Clerk id inside attrs.assignee (Clerk ids are
-- text, not uuid). Promote that to a first-class text column + an assigned-at
-- timestamp so assignment is queryable/indexable without touching the uuid
-- column or the jsonb contract.
alter table ops.tickets add column if not exists assignee    text;
alter table ops.tickets add column if not exists assigned_at  timestamptz;

-- Backfill the column from the attrs contract for rows that already set it via
-- attrs.assignee (mirrors migration 14's promote-from-attrs pattern). Skip the
-- placeholder '—' the mock/data layer uses for "unassigned".
update ops.tickets
   set assignee = attrs->>'assignee'
 where assignee is null
   and attrs ? 'assignee'
   and nullif(attrs->>'assignee', '') is not null
   and attrs->>'assignee' <> '—';

create index if not exists tickets_assignee_idx
  on ops.tickets (assignee) where assignee is not null;

-- 2. Support staff roster (staff identity) ----------------------------------
-- Assignable support staff + their tier on the escalation ladder. Clerk remains
-- the source of truth for identity/auth (role lives in Clerk publicMetadata);
-- this table is the roster the desk assigns from and the map escalation uses to
-- find the next tier. clerk_user_id = the same text id used elsewhere in ops.*.
create table if not exists ops.support_staff (
  clerk_user_id text primary key,
  display_name  text,
  tier          text not null default 'agent',   -- 'agent' (L1) | 'lead' (L2)
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Seed Ben as a lead so the roster is never empty in a fresh estate. On
-- conflict, leave any operator edits intact (no-op re-run).
insert into ops.support_staff (clerk_user_id, display_name, tier)
values ('ben', 'Ben Percival', 'lead')
on conflict (clerk_user_id) do nothing;

-- 3. Escalation history ------------------------------------------------------
-- Append-only record of every escalation: which rung it moved to, why, and who
-- did it. The ticket's CURRENT rung is mirrored onto attrs.escalation_level by
-- the data layer for cheap reads; this table is the audit trail.
create table if not exists ops.ticket_escalations (
  id           uuid primary key default gen_random_uuid(),
  ticket_ref   text not null,
  from_level   text,                              -- 'l1' | 'l2' | 'human' | null
  to_level     text not null,                     -- 'l1' | 'l2' | 'human'
  reason       text,
  actor        text,                              -- clerk_user_id / label who escalated
  created_at   timestamptz not null default now()
);

create index if not exists ticket_escalations_ref_idx
  on ops.ticket_escalations (ticket_ref, created_at desc);

-- 4. RLS — keep the new ops.* tables deny-all-by-policy OFF ------------------
-- Same rationale as 05_disable_ops_rls.sql: a cloud-cloned schema may arrive
-- with RLS enabled and no policies (deny-all for sentinel_app). No-op when RLS
-- is already off.
do $$
declare t text;
begin
  foreach t in array array['support_staff','ticket_escalations'] loop
    if to_regclass('ops.'||t) is not null then
      execute format('alter table ops.%I disable row level security', t);
    end if;
  end loop;
end $$;
