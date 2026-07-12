-- 22_persona_drafts.sql — DRAFT store for the Hermes Agent Builder.
--
-- The Agent Builder lets an admin describe a NEW agent/persona in plain English;
-- the system drafts a persona definition (id, label, SOUL system prompt, a
-- read-only suggested tool set, section, autonomy defaults) and PERSISTS IT HERE
-- AS A DRAFT. This table is DELIBERATELY NOT the live persona registry
-- (lib/hermes/brain/personas.ts, which is code): nothing in this table is ever
-- loaded into the running persona set.
--
-- Safety model (documented, enforced in lib/agent-builder/*):
--   * A drafted persona is created with status='draft' and is ADVISORY / READ-ONLY
--     (no gated or side-effecting tools) — the brief can never auto-grant an
--     executable tool.
--   * Approval flips status='draft' → 'approved'. An APPROVED draft is STILL NOT
--     LIVE: turning it into an active persona is a separate, deliberate, manual
--     code/registration step. The builder never mutates the running persona set.
--   * Every create/approve is recorded in the hash-chained audit log
--     (ops.hermes_audit_log via lib/hermes/audit.ts).
--
--   status  draft     → drafted, awaiting human review
--           approved  → reviewed & approved, but NOT live (activation is manual)
--
-- Additive + idempotent. RLS stays disabled on ops.* (see 05_disable_ops_rls.sql);
-- access is gated in the API via requireSectionApi('admin'). The app also lazily
-- creates this table on first write (lib/agent-builder/store.ts), so this file is a
-- belt-and-braces prod migration.

create table if not exists ops.hermes_persona_drafts (
  id            text primary key,
  label         text not null,
  system_prompt text not null,
  allowed_tools text[] default '{}',
  section       text,
  autonomy      jsonb default '{}'::jsonb,
  status        text default 'draft',
  created_by    text,
  created_at    timestamptz default now(),
  approved_by   text,
  approved_at   timestamptz
);

create index if not exists hermes_persona_drafts_status_created_idx
  on ops.hermes_persona_drafts (status, created_at desc);
