-- 08_links_graph.sql — Findings ↔ Ticket ↔ KB ↔ Infra graph (Phase 1).
--
-- Additive + idempotent. Safe to run on an existing DB and re-runnable. Adds the
-- `created_by` provenance column to the existing ops.links edge table so
-- auto-derived edges ('auto:ingest' / 'auto:rule') can be re-derived without
-- clobbering manually-created ones, documents the canonical node-type and
-- relation vocab, and (when the table is clean) adds a soft CHECK on relation.
--
-- ops.components and ops.links already exist (db/init/01_schema.sql). This
-- migration does NOT recreate them. No explicit GRANTs — sentinel_app inherits
-- privileges on the ops schema per the house style (see 01_schema.sql).
--
-- ---------------------------------------------------------------------------
-- Node-type vocab (src_type / dst_type). src_id / dst_id are the public
-- ref / slug / key (NOT a uuid), so edges stay human-readable + extraction-ready:
--   finding   → ops.findings.ref           (e.g. SEC-0009)
--   ticket    → ops.tickets.ref            (e.g. INC-0001 / OPS-0007)
--   component → ops.components.key         (e.g. app, redis, api/admin)
--   kb        → content/kb/<slug>.md slug  (e.g. docker-socket-proxy)
--   container → docker container name      (e.g. yt_app.1)
--   user      → clerk user id / label
--   scan      → ops.jobs / scan run id
--   alert     → ops.alerts id
--
-- Relation vocab (directional src --relation--> dst):
--   raises       finding   → ticket      (auto, raiseTicketFromFinding)
--   affects      finding   → component   (auto:ingest — the NEW spine)
--   runs_on      component → container   (auto — derived from live topology)
--   documents    kb        → finding     (manual)
--   runbook_for  kb        → component   (manual)
--   has_problem  ticket    → ticket      (auto, createRelatedTicket)
--   has_change   ticket    → ticket      (auto, createRelatedTicket)
--   related      ticket    → ticket      (manual)
--   mitigates    ticket    → finding     (manual)
-- ---------------------------------------------------------------------------

-- 1) Provenance column — who/what created the edge. NULL for legacy rows.
--    'auto:ingest' / 'auto:rule' for machine-derived edges; a Clerk user id /
--    label for manual links via POST /api/links.
alter table ops.links add column if not exists created_by text;

-- 2) Soft CHECK on the relation vocab — added ONLY when every existing row
--    already conforms, so the migration never fails on legacy data. The DO block
--    is idempotent: it skips if the constraint already exists or data is dirty.
do $$
declare
  bad_count bigint;
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'links_relation_vocab_chk'
      and conrelid = 'ops.links'::regclass
  ) then
    select count(*) into bad_count
      from ops.links
     where relation not in (
       'raises','affects','runs_on','documents','runbook_for',
       'has_problem','has_change','related','mitigates'
     );
    if bad_count = 0 then
      alter table ops.links
        add constraint links_relation_vocab_chk
        check (relation in (
          'raises','affects','runs_on','documents','runbook_for',
          'has_problem','has_change','related','mitigates'
        ));
    else
      raise notice 'ops.links has % row(s) with an out-of-vocab relation; skipping soft CHECK (re-run after cleanup).', bad_count;
    end if;
  end if;
end $$;

-- 3) Index by creator so auto-reconcile can scope its deletes/upserts to its own
--    provenance without touching manual edges.
create index if not exists links_created_by_idx on ops.links (created_by);
