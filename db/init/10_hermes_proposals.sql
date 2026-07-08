-- 10_hermes_proposals.sql — persistence for Hermes agent proposals (approval queue)
--
-- Copilot-first: a Hermes agent DRAFTS a proposal (e.g. a customer reply) and it
-- is persisted here so a human can approve/dismiss it from the approval queue.
-- Approving a draft posts it to the ticket as a reply (see lib/hermes/proposals.ts).
--
--   status  pending  → awaiting a human decision
--           sent     → approved (draft posted) or marked sent from the ticket panel
--           dismissed→ rejected
--
-- Additive + idempotent. RLS stays disabled on ops.* (see 05_disable_ops_rls.sql);
-- access is gated in the API via requireSectionApi('support'). The app also lazily
-- creates this table on first write (lib/hermes/proposals.ts), so this file is a
-- belt-and-braces prod migration. gen_random_uuid() matches the other ops.* tables.

create table if not exists ops.hermes_proposals (
  id          uuid default gen_random_uuid() primary key,
  ref         text,
  agent       text,
  kind        text,
  title       text,
  summary     text,
  proposal    jsonb,
  status      text default 'pending',
  created_at  timestamptz default now(),
  decided_at  timestamptz,
  decided_by  text
);

create index if not exists hermes_proposals_status_created_idx
  on ops.hermes_proposals (status, created_at desc);
