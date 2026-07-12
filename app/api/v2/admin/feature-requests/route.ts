// v2 Feature-Request Clustering API.
//
// GET  /api/v2/admin/feature-requests
//   → the ranked feature-request THEMES for the CTO/roadmap view. Deterministic
//     keyword clustering always; Brain-refined labels/summaries/roadmap titles
//     when HERMES_BRAIN_ENABLED. Read-only — never writes to the roadmap.
//
// POST /api/v2/admin/feature-requests
//   → draft ONE theme to the roadmap. This does NOT write ops.roadmap_items; it
//     creates a DRAFT proposal on the existing Hermes proposals spine so a human
//     approves it from the Approvals queue. The roadmap stays human-gated.
//
// Auth: gated on the `hermes` section (the console section these live under).

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getFeatureRequestClusters } from '@/lib/feature-requests/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  try {
    const result = await getFeatureRequestClusters();
    return NextResponse.json(result);
  } catch (e: any) {
    // Never 500 the console — degrade to an empty, deterministic result.
    return NextResponse.json({
      clusters: [],
      live: false,
      brainRefined: false,
      candidateCount: 0,
      labelSource: 'deterministic',
      error: e?.message ?? 'failed to cluster feature requests',
    });
  }
}

type DraftBody = {
  label?: string;
  suggestedRoadmapTitle?: string;
  summary?: string;
  keywords?: string[];
  count?: number;
  exampleRefs?: string[];
};

export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  let body: DraftBody;
  try {
    body = (await req.json()) as DraftBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const title = (body.suggestedRoadmapTitle || body.label || '').trim();
  if (!title) {
    return NextResponse.json({ ok: false, error: 'a label or suggested title is required' }, { status: 400 });
  }

  // Build the human-readable draft. We deliberately DO NOT call any roadmap write
  // helper — the proposal is advisory only and a human turns it into a roadmap
  // item after approving. saveProposal is a no-op with no DB (returns null).
  const examples = (body.exampleRefs ?? []).filter((r) => typeof r === 'string').slice(0, 8);
  const keywords = (body.keywords ?? []).filter((k) => typeof k === 'string').slice(0, 6);

  const draftLines = [
    `Suggested roadmap item: ${title}`,
    body.summary ? `\n${body.summary}` : '',
    keywords.length ? `\nTheme keywords: ${keywords.join(', ')}` : '',
    typeof body.count === 'number' ? `\nBacked by ${body.count} feature request(s).` : '',
    examples.length ? `\nExample requests: ${examples.join(', ')}` : '',
    '\n\nThis is a draft for review — approving does NOT modify the roadmap; create the roadmap item manually once agreed.',
  ];
  const draft = draftLines.filter(Boolean).join('');

  try {
    const { saveProposal } = await import('@/lib/hermes/proposals');
    const id = await saveProposal({
      ref: '', // no ticket ref → approving simply marks it sent, never posts a comment
      agent: 'feature-clustering',
      kind: 'roadmap-draft',
      title: `Roadmap draft: ${title}`,
      summary: body.summary || `Themed from ${body.count ?? examples.length} feature request(s).`,
      proposal: {
        ok: true,
        configured: true,
        classification: 'roadmap-draft',
        draft,
        reasoning:
          'Drafted from clustered feature requests. Advisory only — the roadmap is never written automatically.',
      },
    });

    return NextResponse.json({
      ok: true,
      // null id = no DB in this environment; the draft was accepted but not persisted.
      id,
      persisted: Boolean(id),
      title,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'failed to save draft' }, { status: 500 });
  }
}
