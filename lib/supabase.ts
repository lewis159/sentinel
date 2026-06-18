import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only service-role client for the SHARED Supabase project (the same DB
// behind YT Transcriber). Never import this into a client component.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasSupabase = Boolean(url && serviceKey);

export const supabaseAdmin: SupabaseClient | null = hasSupabase
  ? createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// Sentinel's own schema (findings, tickets, links, …) lives in `ops`.
export const ops = () => supabaseAdmin?.schema('ops');
