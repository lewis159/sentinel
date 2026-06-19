-- 06_user_layouts.sql — per-user dashboard layout persistence (additive, idempotent)
--
-- Stores arbitrary saved layouts keyed by (clerk_user_id, layout_key). The
-- ticket-detail dashboard uses layout_key = 'ticket-detail'; the same table can
-- back any future drag/resize dashboard. `layout` is opaque JSON owned by the UI
-- (react-grid-layout breakpoint → Layout[] map). RLS stays disabled on ops.* (see
-- 05_disable_ops_rls.sql); access is gated in the API via requireOpsAuth().

create table if not exists ops.user_layouts (
  clerk_user_id text not null,
  layout_key    text not null,
  layout        jsonb not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (clerk_user_id, layout_key)
);

-- Keep updated_at fresh on upsert/update (ops.set_updated_at defined in 01_schema.sql).
drop trigger if exists trg_user_layouts_updated on ops.user_layouts;
create trigger trg_user_layouts_updated
  before update on ops.user_layouts
  for each row execute function ops.set_updated_at();
