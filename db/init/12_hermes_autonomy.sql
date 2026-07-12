-- 12_hermes_autonomy.sql — the governance keystone: per-(persona, tool) autonomy
-- dials + the numeric approval thresholds the Hermes governance page shows.
--
-- The shared Brain (lib/hermes/brain/*) resolves, before running any tool, an
-- effective autonomy MODE for (persona, tool):
--   auto        → the graph executes the tool immediately (read / safe).
--   gated       → the graph INTERRUPTS and a human must approve it in the
--                 Sentinel Approvals queue before it runs.
--   draft_only  → the agent may PROPOSE the call but even "safe" tools do NOT
--                 auto-execute — nothing runs; the proposed call is recorded.
--
-- Precedence at runtime (lib/hermes/brain/autonomy.ts):
--   hermes.autonomy_config row  →  persona.autonomyByTool  →  tool's own default.
-- Flipping a dial here (via the settings page / API) therefore changes whether a
-- tool interrupts for approval, with NO code change.
--
-- Idempotent + additive. Lives in the dedicated `hermes` schema (same schema as
-- the Brain checkpointer + hermes.threads). The app also lazily creates these
-- tables on first read/write (autonomy.ts), so this file is belt-and-braces.

create schema if not exists hermes;

-- Per-(persona, tool) effective autonomy mode.
create table if not exists hermes.autonomy_config (
  persona     text not null,
  tool        text not null,
  mode        text not null default 'gated'
                check (mode in ('auto', 'gated', 'draft_only')),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  primary key (persona, tool)
);

-- Numeric governance thresholds the page shows (auto-refund cap, etc.). Stored as
-- text so "£15" / "2× tier" / "4 hrs" round-trip exactly as displayed/edited.
create table if not exists hermes.autonomy_thresholds (
  key         text primary key,
  label       text not null,
  value       text,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- ---- Seed defaults (safe reads auto; money/account gated; copilots draft-only).
-- ON CONFLICT DO NOTHING so re-running never clobbers operator edits.
insert into hermes.autonomy_config (persona, tool, mode) values
  ('pa', 'getTicket',        'auto'),
  ('pa', 'listTickets',      'auto'),
  ('pa', 'getDeployStatus',  'auto'),
  ('pa', 'broadcastStatus',  'auto'),
  ('pa', 'updateTicket',     'gated'),
  -- The five department copilots are draft-only: they propose, never execute.
  ('support',    'getTicket', 'draft_only'), ('support',    'listTickets', 'draft_only'),
  ('support',    'updateTicket', 'draft_only'), ('support',    'getDeployStatus', 'draft_only'),
  ('incident',   'getTicket', 'draft_only'), ('incident',   'listTickets', 'draft_only'),
  ('incident',   'updateTicket', 'draft_only'), ('incident',   'getDeployStatus', 'draft_only'),
  ('escalation', 'getTicket', 'draft_only'), ('escalation', 'listTickets', 'draft_only'),
  ('escalation', 'updateTicket', 'draft_only'), ('escalation', 'getDeployStatus', 'draft_only'),
  ('billing',    'getTicket', 'draft_only'), ('billing',    'listTickets', 'draft_only'),
  ('billing',    'updateTicket', 'draft_only'), ('billing',    'getDeployStatus', 'draft_only'),
  ('security',   'getTicket', 'draft_only'), ('security',   'listTickets', 'draft_only'),
  ('security',   'updateTicket', 'draft_only'), ('security',   'getDeployStatus', 'draft_only')
on conflict (persona, tool) do nothing;

insert into hermes.autonomy_thresholds (key, label, value, sort) values
  ('auto_refund_cap',      'Auto-refund cap',                  '£15',      10),
  ('refund_cap_30d',       'Refund cap / customer / 30d',      '£30',      20),
  ('quota_bump_max',       'Quota bump max',                   '2× tier',  30),
  ('bump_time_box',        'Bump time-box',                    '14 days',  40),
  ('auto_actions_per_week','Auto-actions / customer / wk',     '1',        50),
  ('founder_sla',          'Founder approval SLA',             '4 hrs',    60)
on conflict (key) do nothing;
