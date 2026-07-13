-- 25_channel_audit.sql — widen the audit action allow-list for channel events.
--
-- 15_hermes_p3_substrate.sql declared a CHECK on ops.hermes_audit_log.action;
-- 23_console_settings.sql last recreated it to cover the proposal.* / integration.*
-- / persona.* / console.settings.updated actions. The Telegram channel surface
-- (lib/hermes/channels/* + app/api/hermes/channels/telegram) appends a new
-- 'channel.telegram.message' event when an allowlisted user's message is routed
-- to the Brain. Recreate the constraint to include it so those inbound turns are
-- recorded in the immutable, hash-chained audit log rather than rejected at the
-- DB. Additive + idempotent — keep in lockstep with lib/hermes/audit.ts.
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
        'console.settings.updated',
        'channel.telegram.message'
      ));
  end if;
end $$;
