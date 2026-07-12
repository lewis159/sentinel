// Board / Founder-Update API (admin-gated).
//
//   GET  → assemble the current month's update (read-only) + render the draft.
//   POST → { action: 'regenerate' } re-assembles + re-renders (fresh draft);
//          { action: 'save' }       assembles, renders, and persists the draft to
//                                    the proposal queue as kind 'board-update'.
//
// DRAFT ONLY — nothing is emailed/posted. Saving stores the markdown for the
// founder to review and send by hand. Mock-safe: with no DB, assembly runs on
// mock data and `save` is a no-op (ok:false, note explains).
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { assembleBoardUpdate } from '@/lib/board-update/assemble';
import { buildDraft, saveBoardUpdateDraft } from '@/lib/board-update/draft';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const update = await assembleBoardUpdate();
    const draft = await buildDraft(update);
    return NextResponse.json({ update, draft });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to assemble board update' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const denied = await requireSectionApi('admin');
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as { action?: string; noLlm?: boolean } | null;
    const action = body?.action === 'save' ? 'save' : 'regenerate';

    const update = await assembleBoardUpdate();
    const draft = await buildDraft(update, { noLlm: body?.noLlm === true });

    if (action === 'save') {
      const id = await saveBoardUpdateDraft(update, draft.markdown);
      return NextResponse.json({
        ok: id != null,
        id,
        update,
        draft,
        note: id == null ? 'No database in this environment — draft not persisted (mock-safe no-op).' : undefined,
      });
    }

    return NextResponse.json({ ok: true, update, draft });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Failed to build board update' }, { status: 500 });
  }
}
