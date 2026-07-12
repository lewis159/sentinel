-- 21_runtime_flags.sql — runtime override store for Hermes feature flags.
--
-- WHY: the Hermes feature flags (HERMES_BRAIN_ENABLED, HERMES_INTAKE_ENABLED,
-- HERMES_KB_PGVECTOR, HERMES_INNGEST_ENABLED, …) are read from the process
-- environment today (lib/hermes/brain/flags.ts). Changing one means editing the
-- stack env and redeploying. This tiny table lets an admin toggle a flag from the
-- Integrations admin page WITHOUT a redeploy: the flag resolver
-- (lib/hermes/runtime-flags.ts) checks this table FIRST and only falls back to the
-- env default when there is no override row.
--
-- One row per flag. `enabled` is the override value; deleting the row (or the
-- table not existing) reverts to the env default. `updated_by` records the Clerk
-- user id that last set it (for the audit trail). NEVER stores any secret value.
--
-- Additive + idempotent. Lives in the `ops` schema alongside the other Hermes
-- tables; RLS stays disabled on ops.* (see 05_disable_ops_rls.sql). The app also
-- lazily creates this table on the write path (lib/hermes/runtime-flags.ts), so
-- this file is a belt-and-braces prod migration.
--
-- NOTE: only SERVER-READ flags can be runtime-toggled here. NEXT_PUBLIC_* flags
-- are inlined into the client bundle at build time and cannot be changed at
-- runtime — they are intentionally out of scope for this store.

create table if not exists ops.hermes_runtime_flags (
  flag       text primary key,          -- the env flag name, e.g. 'HERMES_BRAIN_ENABLED'
  enabled    boolean not null,          -- the override value
  updated_at timestamptz not null default now(),
  updated_by text                       -- Clerk user id that last set it (nullable)
);
