-- Sentinel — SLA timers on tickets. Idempotent; runs after 17_enable_tenant_rls.
-- Additive: does NOT add/rename columns that other code depends on and never
-- drops anything. Safe to re-run.
--
-- WHY: the support desk needs an at-a-glance SLA badge (remaining time /
-- "due soon" / "BREACHED") and a way to flag a breached OPEN ticket for the
-- human queue. The resolution DEADLINE lives in ops.tickets.sla_due
-- (timestamptz) — a column that already exists (added in 02_service_management),
-- but which is NULL for most historical rows because nothing set it. This
-- migration BACKFILLS sla_due for still-open tickets from
-- (created_at + policy target) so the badge is meaningful for existing data,
-- and guarantees the lookup index exists. New rows get sla_due at insert time
-- (lib/data.ts createTicket) so this backfill only ever touches legacy rows.
--
-- The policy encoded here MIRRORS lib/support/sla.ts:
--   resolution target by priority  (incident baseline):
--     critical 4h · high 8h · medium 24h · low 48h · info 72h
--   × per-kind factor: incident 1 · request 1.5 · problem 2 · change/release 3
-- Keep the two in step if either changes.

-- 1. Defensive: ensure the deadline column exists (no-op if 02 already ran). ---
alter table ops.tickets add column if not exists sla_due timestamptz;

-- 2. Backfill sla_due for OPEN tickets that don't have one yet ---------------
--    Only touches rows where sla_due is null AND the ticket is not in a terminal
--    (closed/resolved) status, so a re-run — or a row that already carries a
--    deadline — is a no-op. Derives the deadline from created_at (falling back to
--    opened_at, then now()) + the priority×kind resolution target.
update ops.tickets t
   set sla_due = coalesce(t.created_at, t.opened_at, now())
                 + (
                     -- priority baseline (hours)
                     (case lower(coalesce(t.priority, 'medium'))
                        when 'critical' then interval '4 hours'
                        when 'high'     then interval '8 hours'
                        when 'medium'   then interval '24 hours'
                        when 'low'      then interval '48 hours'
                        when 'info'     then interval '72 hours'
                        else interval '24 hours'
                      end)
                     -- per-kind factor
                     * (case lower(coalesce(t.kind, 'incident'))
                          when 'incident' then 1.0
                          when 'request'  then 1.5
                          when 'problem'  then 2.0
                          when 'change'   then 3.0
                          when 'release'  then 3.0
                          else 1.0
                        end)
                   )
 where t.sla_due is null
   and lower(coalesce(t.status, 'open')) not in (
     'resolved', 'closed', 'fulfilled', 'cancelled', 'canceled',
     'implemented', 'done', 'completed'
   );

-- 3. Index for the SLA lookups (breach sweep / "due soon" filters). ----------
--    tickets_sla_idx already exists from 02_service_management; recreate guarded
--    so this migration is self-contained if run against an older schema.
create index if not exists tickets_sla_idx on ops.tickets (sla_due) where sla_due is not null;
