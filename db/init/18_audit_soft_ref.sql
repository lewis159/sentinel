-- 18_audit_soft_ref.sql — make ops.hermes_audit_log.proposal_id a plain soft-ref.
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- 15_hermes_p3_substrate.sql declared the audit log's proposal_id as an inline
-- FK:  proposal_id uuid references ops.hermes_proposals(id) ON DELETE SET NULL.
-- That FK is fundamentally incompatible with the append-only guard on the SAME
-- table (triggers hermes_audit_log_no_update / _no_delete, which hard-fail any
-- UPDATE or DELETE):
--
--   Deleting a proposal that has audit rows fires the FK's ON DELETE SET NULL,
--   which issues  UPDATE ops.hermes_audit_log SET proposal_id = NULL …  — and
--   the append-only trigger rejects that UPDATE with
--     "ops.hermes_audit_log is append-only (UPDATE blocked)".
--
--   Net effect: a proposal that was ever audited can NEVER be deleted. This
--   surfaces in tests/integration/spine.test.ts teardown (it deletes its test
--   proposals) and would equally block any real proposal cleanup / GDPR erase.
--
-- FIX
-- ---------------------------------------------------------------------------
-- An immutable, hash-chained audit log should OUTLIVE the proposal it recorded
-- and keep the original id verbatim (the id is part of the hashed history — we
-- must NOT rewrite it to NULL anyway). So proposal_id becomes a PLAIN uuid
-- "soft reference": we drop the FK entirely. Deleting a proposal then no longer
-- touches ops.hermes_audit_log at all, so the append-only guard is never
-- provoked, and the audit history stays intact and immutable.
--
-- The COLUMN is kept (still populated on insert, still indexed by
-- hermes_audit_log_proposal_idx) — only the referential constraint is removed.
--
-- Idempotent + additive. Runs after 15_hermes_p3_substrate.sql. Safe to re-run.
--
-- NOTE on ops.hermes_tool_executions.proposal_id and
-- ops.hermes_budget_ledger.proposal_id: those columns ALSO carry
-- ON DELETE SET NULL FKs, but NEITHER of those tables has an append-only
-- trigger, so their SET-NULL-on-delete succeeds normally and is harmless. They
-- are intentionally left untouched here.
-- ---------------------------------------------------------------------------

-- Primary path: drop the auto-named FK constraint. Postgres names an inline
-- column FK <table>_<column>_fkey, i.e. hermes_audit_log_proposal_id_fkey.
alter table ops.hermes_audit_log
  drop constraint if exists hermes_audit_log_proposal_id_fkey;

-- Belt-and-braces: if a clone auto-named the constraint differently, find and
-- drop ANY remaining FK on ops.hermes_audit_log.proposal_id so this migration is
-- robust regardless of the original name. Still leaves the column in place.
do $$
declare
  cname text;
begin
  select c.conname into cname
  from pg_constraint c
  join pg_class     rel on rel.oid = c.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'ops'
    and rel.relname = 'hermes_audit_log'
    and c.contype = 'f'
    and c.conkey  = array[
      (select attnum from pg_attribute
        where attrelid = 'ops.hermes_audit_log'::regclass
          and attname = 'proposal_id')
    ]
  limit 1;

  if cname is not null then
    execute format('alter table ops.hermes_audit_log drop constraint %I', cname);
  end if;
end $$;
