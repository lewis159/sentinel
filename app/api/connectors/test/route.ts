import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireOpsAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await requireOpsAuth();
  if (denied) return denied;
  try {
    const { type, config } = await req.json();

    if (type === 'supabase') {
      if (!config?.url || !config?.key) {
        return NextResponse.json({ ok: false, error: 'url and key required' });
      }
      const client = createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { count, error } = await client
        .from('users')
        .select('*', { count: 'exact', head: true });
      if (error) return NextResponse.json({ ok: false, error: error.message });
      return NextResponse.json({ ok: true, count: count ?? 0 });
    }

    return NextResponse.json({ ok: false, error: `No test available for type '${type}'` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'test failed' });
  }
}
