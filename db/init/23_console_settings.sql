-- 23_console_settings.sql — console-level settings key/value store (additive, idempotent)
--
-- Backs the Sentinel v2 Settings hub (app/v2/settings). Every admin-editable
-- console setting (org name, console URL, product domain, support address,
-- timezone, default theme, environment banner, brand accent, plus the per-section
-- keys for Appearance / Notifications / SLA policies / Data & retention / Billing)
-- is stored here as a JSONB value keyed by a stable string.
--
-- IMPORTANT — no rows are seeded. A setting that has never been saved simply has
-- NO row; the store returns "unset" and the UI renders a BLANK field. There are no
-- placeholder / sample values anywhere: blank is the honest default.
--
-- Values here take precedence over any env fallback. RLS stays disabled on ops.*
-- (see 05_disable_ops_rls.sql); access is gated in the API via
-- requireSectionApi('admin'). The app also lazily creates this table on first
-- write (lib/settings/store.ts), so this file is a belt-and-braces prod migration.

create table if not exists ops.console_settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now(),
  updated_by text
);

-- --- Widen the audit action allow-list -------------------------------------
-- 15_hermes_p3_substrate.sql declared a CHECK on ops.hermes_audit_log.action
-- that only permitted the four proposal.* actions. The app already appends
-- integration.* / persona.* events, and this feature adds
-- 'console.settings.updated'. Recreate the constraint to cover every action the
-- application emits so admin settings saves are recorded in the immutable,
-- hash-chained audit log rather than rejected at the DB. Additive + idempotent.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'ops' and table_name = 'hermes_audit_log'
  ) then
    alter table ops.hermes_audit_log
      drop constraint if exists hermes_audit_log_action_check;
    alter table ops.hermes_audit_log
      add constraint hermes_audit_log_action_check
      check (action in (
        'proposal.created', 'proposal.approved',
        'proposal.dismissed', 'proposal.executed',
        'integration.key.set', 'integration.flag.set', 'integration.test',
        'persona.drafted', 'persona.approved',
        'console.settings.updated'
      ));
  end if;
end $$;
