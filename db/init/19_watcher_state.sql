-- 18_watcher_state.sql — persistent "last-seen" marker for the estate watcher cron.
--
-- WHY: lib/inngest/functions/watchers.ts runs every 30 minutes. Step memoization
-- makes a single run idempotent, but it CANNOT stop a genuinely-new run from
-- re-filing a fresh proposal + re-broadcasting every tick while the SAME ongoing
-- condition persists (e.g. main has been red for 3 hours). That would spam the
-- Approvals queue and the #pa-status channel. This tiny table is the cross-run
-- de-dup marker: one row per watcher `signal`, holding a coarse `fingerprint` of
-- the last-alerted condition plus when it was alerted.
--
-- The watcher claims an alert via lib/inngest/signals/watcher-state.ts
-- (claimWatcherAlert): it upserts here and only proceeds to broadcast/file when
-- EITHER the fingerprint changed (the condition materially changed) OR a cooldown
-- window has elapsed (so an unchanged, still-ongoing condition resurfaces at most
-- once per cooldown as a reminder). The claim-and-set is a single atomic upsert so
-- two overlapping ticks can never both alert for the same fingerprint.
--
-- Additive + idempotent. Lives in the `ops` schema alongside the other Hermes
-- tables. RLS stays disabled on ops.* (see 05_disable_ops_rls.sql). The app also
-- lazily creates this table on the write path (lib/inngest/signals/watcher-state.ts),
-- so this file is a belt-and-braces prod migration.

create table if not exists ops.hermes_watcher_state (
  signal          text primary key,          -- the watcher key, e.g. 'estate-watchers'
  fingerprint     text not null,             -- coarse hash of the last-alerted condition
  last_alerted_at timestamptz not null default now(),
  detail          jsonb not null default '{}',
  updated_at      timestamptz not null default now()
);

create index if not exists hermes_watcher_state_alerted_idx
  on ops.hermes_watcher_state (last_alerted_at desc);
