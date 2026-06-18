import { NextResponse } from 'next/server';
import { listConnectors, saveConnector } from '@/lib/connectors';

export const dynamic = 'force-dynamic';

function maskKey(config: any) {
  if (config && typeof config.key === 'string' && config.key) {
    const k = config.key;
    return { ...config, key: '••••' + k.slice(-4) };
  }
  return config;
}

export async function GET() {
  const rows = await listConnectors();
  const items = rows.map((c) => ({ ...c, config: maskKey(c.config) }));
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, type, config, enabled } = body ?? {};
    if (!type) return NextResponse.json({ ok: false, error: 'type required' }, { status: 400 });
    await saveConnector({
      name: name || type,
      type,
      config: config ?? {},
      enabled: !!enabled,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'save failed' }, { status: 500 });
  }
}
