// Budget caps API (admin only) — reads + upserts the per-(persona, tool, scope)
// spend caps in ops.hermes_budgets that lib/hermes/budget.ts meters the Brain's
// tool spend against. Editing a cap here changes what the Brain will allow a
// persona to spend inside its rolling window — no redeploy. Same admin gate +
// audit-label + mock-safe contract as the sibling autonomy route. NEVER returns
// secrets.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import {
  listBudgetCaps,
  upsertBudgetCap,
  GOVERNANCE_PERSONAS,
  BUDGET_WINDOWS,
} from '@/lib/hermes/governance';

export const dynamic = 'force-dynamic';

// GET — current caps (+ best-effort windowed spend), the persona roster, and the
// selectable windows. Admin-gated like the autonomy route.
export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const caps = await listBudgetCaps();
    return NextResponse.json({ caps, personas: GOVERNANCE_PERSONAS, windows: BUDGET_WINDOWS });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Failed to read budget caps' },
      { status: 500 },
    );
  }
}

// POST — upsert one cap (admin-gated). Body:
//   { persona, tool?, scope?, capMajor, windowSeconds }
// capMajor is in MAJOR units (pounds); the lib converts to minor (pennies).
export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as
      | {
          persona?: unknown;
          tool?: unknown;
          scope?: unknown;
          capMajor?: unknown;
          windowSeconds?: unknown;
        }
      | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }

    if (typeof body.persona !== 'string') {
      return NextResponse.json({ ok: false, error: 'persona is required' }, { status: 400 });
    }
    // Coerce numeric fields defensively (a form may send them as strings).
    const capMajor =
      typeof body.capMajor === 'number' ? body.capMajor : Number(body.capMajor);
    const windowSeconds =
      typeof body.windowSeconds === 'number' ? body.windowSeconds : Number(body.windowSeconds);
    if (!Number.isFinite(capMajor)) {
      return NextResponse.json({ ok: false, error: 'cap must be a number' }, { status: 400 });
    }
    if (!Number.isFinite(windowSeconds)) {
      return NextResponse.json({ ok: false, error: 'window must be a number' }, { status: 400 });
    }

    let by = 'admin';
    try {
      const { userId } = await getSessionAccess();
      if (userId) by = userId;
    } catch {
      /* best-effort audit label */
    }

    const result = await upsertBudgetCap({
      persona: body.persona,
      tool: typeof body.tool === 'string' ? body.tool : undefined,
      scope: typeof body.scope === 'string' ? body.scope : undefined,
      capMajor,
      windowSeconds,
      by,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to save budget cap' },
      { status: 500 },
    );
  }
}
