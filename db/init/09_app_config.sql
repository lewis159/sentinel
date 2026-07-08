-- 09_app_config.sql — runtime app config key/value store (additive, idempotent)
--
-- Backs admin-editable runtime settings that would otherwise live only in env
-- vars. Currently used by the Hermes/OpenRouter provider config:
--   key 'hermes.openrouter_key'  → OpenRouter API key (secret; never returned to client)
--   key 'hermes.model'           → model id override (falls back to env/default)
--
-- Values here take precedence over process.env; env is the fallback. RLS stays
-- disabled on ops.* (see 05_disable_ops_rls.sql); access is gated in the API via
-- requireSectionApi('admin'). The app also lazily creates this table on first
-- write (lib/hermes/config.ts), so this file is a belt-and-braces prod migration.

create table if not exists ops.app_config (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);
