// Onboarding assistant API (v2) — Hermes-section gated.
//
//   GET  — recent customers + their onboarding progress (first-success %,
//          milestones, unused features). Read-only, mock-safe.
//   POST — draft a "what to try next" nudge for a customer, and OPTIONALLY queue
//          it to the human approval gate. NOTHING is ever sent from here:
//            { customerId }                → draft only (preview)
//            { customerId, queue: true }   → draft + saveProposal (needs approval)
//
// Gated by the `hermes` section (requireSectionApi) — the same section the
// onboarding page uses. Dormant-safe: the LLM only personalises the nudge when
// HERMES_BRAIN_ENABLED is on; otherwise the deterministic template ships.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { getOnboardingBoard, getOnboardingCustomer } from '@/lib/onboarding/data';
import { draftNudge, queueNudge } from '@/lib/onboarding/nudge';

export const dynamic = 'force-dynamic';

// GET — the board feed.
export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  try {
    const board = await getOnboardingBoard();
    return NextResponse.json({ ...board, brainEnabled: brainEnabled() });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'failed to load onboarding board' },
      { status: 500 },
    );
  }
}

// POST — draft (and optionally queue) a nudge.
export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  let body: { customerId?: unknown; queue?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const customerId = typeof body.customerId === 'string' ? body.customerId.trim() : '';
  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
  }

  const progress = await getOnboardingCustomer(customerId);
  if (!progress) {
    return NextResponse.json({ error: 'customer not found' }, { status: 404 });
  }

  try {
    // Queue → raise to the approval gate (still no send). Otherwise preview only.
    if (body.queue === true) {
      const { userId } = await getSessionAccess();
      const res = await queueNudge({ progress, by: userId ?? 'operator' });
      return NextResponse.json({
        ok: true,
        queued: true,
        proposalId: res.proposalId,
        draft: res.draft,
        // Surface when there's no DB so the UI can explain why nothing persisted.
        persisted: res.proposalId != null,
      });
    }

    const draft = await draftNudge(progress);
    return NextResponse.json({ ok: true, queued: false, draft });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'failed to draft nudge' },
      { status: 500 },
    );
  }
}
