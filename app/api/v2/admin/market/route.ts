// Hermes · Market & Content API (section-gated, mock-safe).
//
//   GET  — the tracked competitor set + SEO keyword targets + config flags, so
//          the page can render the dormant view with no DB.
//   POST — run an action, each of which produces a DRAFT proposal (nothing
//          publishes, no live web fetch):
//            { action: 'scan-competitor', slug }              → competitor-brief
//            { action: 'draft-content', keyword, type, commit } → content-draft
//
// Gated by the SAME `hermes` section as the rest of the Hermes console (the page
// lives under /v2/hermes/market). Prod-safe: read-only sources + draft-only
// writes; every path degrades cleanly with no DB (saveProposal is a no-op that
// returns a null id) and no model (deterministic skeletons / notes).
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import {
  listCompetitors,
  listKeywords,
  CONTENT_TYPES,
  isContentType,
  OPERATOR_MAINTAINED,
  LIVE_WEB_SOURCE_WIRED,
} from '@/lib/market/config';
import { scanCompetitor } from '@/lib/market/competitors';
import { draftContent } from '@/lib/market/content';

export const dynamic = 'force-dynamic';

// GET — config snapshot for the page (no DB required).
export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  return NextResponse.json({
    ok: true,
    brainEnabled: brainEnabled(),
    operatorMaintained: OPERATOR_MAINTAINED,
    liveWebSourceWired: LIVE_WEB_SOURCE_WIRED,
    contentTypes: CONTENT_TYPES,
    competitors: listCompetitors(),
    keywords: listKeywords(),
  });
}

// POST — run a draft-producing action.
export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const action = String(body?.action ?? '');

  if (action === 'scan-competitor') {
    const slug = String(body?.slug ?? '').trim();
    if (!slug) return NextResponse.json({ ok: false, error: 'slug is required' }, { status: 400 });
    // Scans always commit a draft brief to the approval queue.
    const res = await scanCompetitor({ slug, commit: true });
    return NextResponse.json(res, { status: res.ok ? 200 : 404 });
  }

  if (action === 'draft-content') {
    const keyword = String(body?.keyword ?? '').trim();
    const type = body?.type;
    if (!keyword) return NextResponse.json({ ok: false, error: 'keyword is required' }, { status: 400 });
    if (!isContentType(type))
      return NextResponse.json({ ok: false, error: 'type must be blog | help | landing' }, { status: 400 });
    // commit=false → preview only (no proposal); commit=true → queue the draft.
    const commit = body?.commit === true;
    const res = await draftContent({ keyword, type, commit });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
}
