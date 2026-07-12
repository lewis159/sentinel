// Autonomy dials API (admin only) — reads + writes the per-(persona, tool)
// autonomy modes and the numeric governance thresholds the Hermes settings page
// shows. Backs lib/hermes/brain/autonomy.ts (the store the Brain reads before
// running any tool). Persisting a change here changes gate behaviour with no
// redeploy. NEVER returns secrets.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import {
  getAutonomyTools,
  getAutonomyThresholds,
  saveAutonomyConfig,
  isAutonomyMode,
} from '@/lib/hermes/brain/autonomy';
import { getAutonomyMatrix, GOVERNANCE_PERSONAS } from '@/lib/hermes/governance';

export const dynamic = 'force-dynamic';

// GET — current dials + thresholds. Admin-gated like the provider settings.
export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    // `tools`/`thresholds` keep the P1 shape (HermesAutonomyDials consumes them);
    // `matrix`/`personas` are ADDITIVE — the governance console's richer matrix
    // (every cell tagged code-default vs DB-override) + the persona roster.
    const [tools, thresholds, matrix] = await Promise.all([
      getAutonomyTools(),
      getAutonomyThresholds(),
      getAutonomyMatrix(),
    ]);
    return NextResponse.json({
      tools,
      thresholds,
      modes: ['auto', 'gated', 'draft_only'],
      matrix,
      personas: GOVERNANCE_PERSONAS,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Failed to read autonomy config' },
      { status: 500 },
    );
  }
}

// POST — persist edited dials / thresholds (admin-gated).
// Body: { tools?: {persona,tool,mode}[], thresholds?: {key,value}[] }
export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as
      | { tools?: unknown; thresholds?: unknown }
      | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    const tools = Array.isArray(body.tools)
      ? body.tools.filter(
          (t: any): t is { persona: string; tool: string; mode: string } =>
            t &&
            typeof t.persona === 'string' &&
            typeof t.tool === 'string' &&
            isAutonomyMode(t.mode),
        )
      : undefined;

    const thresholds = Array.isArray(body.thresholds)
      ? body.thresholds.filter(
          (t: any): t is { key: string; value: string } =>
            t && typeof t.key === 'string',
        ).map((t: any) => ({ key: t.key, value: String(t.value ?? '') }))
      : undefined;

    let by = 'admin';
    try {
      const { userId } = await getSessionAccess();
      if (userId) by = userId;
    } catch {
      /* best-effort audit label */
    }

    const result = await saveAutonomyConfig({ tools, thresholds, by });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to save autonomy config' },
      { status: 500 },
    );
  }
}
