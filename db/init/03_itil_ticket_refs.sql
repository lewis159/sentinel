-- Sentinel — per-kind ITIL ticket refs. Idempotent; runs after
-- 02_service_management.sql. Gives each ITIL practice its own ref series
-- (INC-/REQ-/CHG-/PRB-/REL-####) instead of the shared OPS-#### series.
--
-- The app (lib/data.ts → createTicket) calls ops.next_ticket_ref(kind) to mint
-- a ref BEFORE insert and passes it explicitly, so the legacy set_ticket_ref()
-- trigger (which only fires when ref IS NULL) is bypassed. Keeping a SQL-side
-- minter means the series is race-safe (sequences are atomic) and any direct
-- SQL inserts can use it too.

-- One sequence per kind.
create sequence if not exists ops.inc_seq;
create sequence if not exists ops.req_seq;
create sequence if not exists ops.chg_seq;
create sequence if not exists ops.prb_seq;
create sequence if not exists ops.rel_seq;

-- Mint the next ref for a given ITIL kind. Falls back to the OPS- series for
-- any unknown kind so it never returns null.
create or replace function ops.next_ticket_ref(p_kind text)
returns text language plpgsql as $$
declare
  prefix text;
  seq    regclass;
begin
  case p_kind
    when 'incident' then prefix := 'INC'; seq := 'ops.inc_seq';
    when 'request'  then prefix := 'REQ'; seq := 'ops.req_seq';
    when 'change'   then prefix := 'CHG'; seq := 'ops.chg_seq';
    when 'problem'  then prefix := 'PRB'; seq := 'ops.prb_seq';
    when 'release'  then prefix := 'REL'; seq := 'ops.rel_seq';
    else                 prefix := 'OPS'; seq := 'ops.ticket_seq';
  end case;
  return prefix || '-' || lpad(nextval(seq)::text, 4, '0');
end; $$;

-- Seed each sequence past any refs already present (e.g. from mock-backed dev
-- or earlier inserts) so freshly minted refs never collide. Safe to re-run.
do $$
declare
  rec record;
begin
  for rec in
    select kind, max((regexp_replace(ref, '\D', '', 'g'))::int) as maxn
      from ops.tickets
     where ref ~ '^(INC|REQ|CHG|PRB|REL)-\d+$'
     group by kind
  loop
    case rec.kind
      when 'incident' then perform setval('ops.inc_seq', greatest(rec.maxn, 1));
      when 'request'  then perform setval('ops.req_seq', greatest(rec.maxn, 1));
      when 'change'   then perform setval('ops.chg_seq', greatest(rec.maxn, 1));
      when 'problem'  then perform setval('ops.prb_seq', greatest(rec.maxn, 1));
      when 'release'  then perform setval('ops.rel_seq', greatest(rec.maxn, 1));
      else null;
    end case;
  end loop;
end $$;
