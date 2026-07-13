-- 24_comment_visibility.sql — internal vs external visibility on ticket comments.
--
-- WHY: today an operator note and a customer-visible reply are indistinguishable
-- rows in ops.comments (only `kind` differs, and that is not a visibility gate).
-- Before any customer-facing portal can read a ticket's thread, comments must
-- carry an explicit visibility flag so a customer view can filter to ONLY the
-- comments meant for them. This is the security prerequisite for that portal.
--
-- SAFE DEFAULT: the new column defaults to 'internal'. Anything not explicitly
-- marked 'external' stays hidden from customers (fail-safe / deny-by-default) —
-- so a future customer read that filters on visibility='external' can never leak
-- an operator note, even one written before this migration ran.
--
-- Additive + idempotent: safe to re-run (add column if not exists, guarded
-- constraint, create index if not exists). No existing column/behaviour changes.

-- 1. The visibility column. Defaults to the safe value for every existing row.
alter table ops.comments
  add column if not exists visibility text not null default 'internal';

-- 2. Constrain the domain to the two valid values (idempotent add).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comments_visibility_chk'
  ) then
    alter table ops.comments
      add constraint comments_visibility_chk
      check (visibility in ('internal', 'external'));
  end if;
end $$;

-- 3. Index to support the customer-facing read (comments for one ticket that are
--    external), matching the existing (ticket_id, created_at) ordering.
create index if not exists comments_ticket_visibility_idx
  on ops.comments (ticket_id, visibility, created_at);

-- 4. Backfill. The new column defaulted EVERY existing row to 'internal' (the
--    safe baseline). Now promote the rows that were already customer-originated
--    or customer-visible to 'external', identified by their `kind`:
--      * 'customer'  — the customer's own inbound message (chat or email reply).
--      * 'ai-reply'  — the L1 answer that WAS shown back to the customer.
--    Everything else stays internal, deliberately:
--      * 'ai-draft'  — an AI draft a human reviews; NEVER sent to the customer.
--      * 'update' / 'comment' / 'reply' — operator/agent internal notes.
--    Only touch rows still at the default so a re-run is a no-op.
update ops.comments
   set visibility = 'external'
 where visibility <> 'external'
   and kind in ('customer', 'ai-reply');
