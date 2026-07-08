import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getPublicHermesConfig, setHermesConfig } from '@/lib/hermes/config';

export const dynamic = 'force-dynamic';

// GET /api/v2/settings/hermes — current Hermes/OpenRouter config (admin only).
// NEVER returns the raw API key: only { model, hasKey, keyHint?, source }.
export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    return NextResponse.json(await getPublicHermesConfig());
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Failed to read Hermes config' },
      { status: 500 },
    );
  }
}

// POST /api/v2/settings/hermes — set model / apiKey / clearKey (admin only).
// Body: { model?: string; apiKey?: string; clearKey?: boolean }
// The key is stored server-side and NEVER echoed back in the response.
export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as
      | { model?: unknown; apiKey?: unknown; clearKey?: unknown }
      | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'Invalid request body' },
        { status: 400 },
      );
    }

    if (body.model !== undefined && typeof body.model !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'model must be a string' },
        { status: 400 },
      );
    }
    if (body.apiKey !== undefined && typeof body.apiKey !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'apiKey must be a string' },
        { status: 400 },
      );
    }

    const result = await setHermesConfig({
      model: typeof body.model === 'string' ? body.model : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      clearKey: body.clearKey === true,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to save Hermes config' },
      { status: 500 },
    );
  }
}
