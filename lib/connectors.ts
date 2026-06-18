import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { q, q1 } from './db';

// Configurable external data sources, stored in public.connectors. The Supabase
// connector lets Sentinel pull real YT Transcriber data (users/videos) without
// baking credentials into env — configured via Settings → Connectors.

export type Connector = {
  id: string; name: string; type: string; config: any; enabled: boolean; status: string; updated_at: string;
};

export async function listConnectors(): Promise<Connector[]> {
  return q<Connector>(
    'select id,name,type,config,enabled,status,updated_at from public.connectors order by created_at asc'
  );
}

// Build a Supabase client from the first enabled supabase connector, or null.
export async function getSupabase(): Promise<SupabaseClient | null> {
  const row = await q1<{ config: any }>(
    "select config from public.connectors where type = 'supabase' and enabled = true order by updated_at desc limit 1"
  );
  if (!row?.config?.url || !row?.config?.key) return null;
  return createClient(row.config.url, row.config.key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Upsert (single-row-per-type for now) a connector's config.
export async function saveConnector(input: { name: string; type: string; config: any; enabled: boolean }): Promise<void> {
  const existing = await q1<{ id: string }>('select id from public.connectors where type = $1 limit 1', [input.type]);
  if (existing) {
    await q(
      'update public.connectors set name=$1, config=$2, enabled=$3, status=$4, updated_at=now() where id=$5',
      [input.name, input.config, input.enabled, input.config?.url ? 'configured' : 'unconfigured', existing.id]
    );
  } else {
    await q(
      'insert into public.connectors (name,type,config,enabled,status) values ($1,$2,$3,$4,$5)',
      [input.name, input.type, input.config, input.enabled, input.config?.url ? 'configured' : 'unconfigured']
    );
  }
}
