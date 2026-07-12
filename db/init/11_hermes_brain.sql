-- 11_hermes_brain.sql — the "Brain" (LangGraph) memory + checkpoint schema.
--
-- The shared Brain (lib/hermes/brain/*) runs LangGraph.js in-process inside the
-- Sentinel Next.js server. Its conversation state / checkpoints are persisted by
-- the official Postgres checkpointer (@langchain/langgraph-checkpoint-postgres)
-- into a DEDICATED `hermes` schema so it stays cleanly separated from `ops.*`.
--
-- Idempotent + additive. Two responsibilities:
--   1. Create the `hermes` schema (the checkpointer's own tables — checkpoints,
--      checkpoint_writes, checkpoint_blobs, checkpoint_migrations — are created
--      by the library's setup() at runtime; see lib/hermes/brain/checkpointer.ts,
--      which runs the pool with search_path=hermes so they land here).
--   2. A small `hermes.threads` index so operators can see conversation threads
--      (surface, persona, last activity) without cracking open the checkpoint blobs.
--
-- Gated actions still reuse ops.hermes_proposals (see 10_hermes_proposals.sql);
-- the pending tool-call (tool + args + thread_id) is carried inside the proposal
-- jsonb `proposal.action` (HermesProposal.action) — no new columns needed there.

create schema if not exists hermes;

-- Optional human-facing index of Brain conversations. The checkpointer is the
-- source of truth for state; this table is just a convenience for the console.
create table if not exists hermes.threads (
  thread_id   text primary key,          -- e.g. 'discord:<channelId>' | 'web:<id>'
  surface     text,                       -- 'discord' | 'web' | 'ticket' | ...
  persona     text,                       -- 'pa' | ...
  last_message text,                       -- last user/assistant snippet (truncated)
  message_count integer not null default 0,
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);

create index if not exists hermes_threads_last_at_idx
  on hermes.threads (last_at desc);
