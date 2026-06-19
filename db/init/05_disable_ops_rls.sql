-- Sentinel — disable redundant RLS on the ops schema. Idempotent; safe to re-run.
--
-- Context: when the ops schema is CLONED from a cloud Supabase project (pg_dump),
-- the base tables arrive with row-level security ENABLED but NO policies — which
-- means deny-all for every non-superuser role. Sentinel connects as a scoped,
-- non-superuser role (sentinel_app, ops-schema only), so deny-all hides every row.
--
-- RLS is redundant here: access to the ops schema is already gated at the app
-- layer (Clerk global_admin) and the DB layer (sentinel_app has ops privileges
-- only). A fresh repo deploy never enables RLS on these tables; this migration
-- exists to correct cloud-cloned environments. No-op when RLS is already off.
do $$
declare t text;
begin
  foreach t in array array[
    'alerts','comments','components','container_snapshots',
    'findings','links','rules','tickets',
    'roadmap_items','changelog_entries','user_app_access','access_audit'
  ] loop
    if to_regclass('ops.'||t) is not null then
      execute format('alter table ops.%I disable row level security', t);
    end if;
  end loop;
end $$;
