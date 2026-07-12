// Hermes · KB Auto-Authoring API (hermes-section gated).
//
//   GET  → ranked KB gaps: resolved tickets whose question the current KB fails
//          to cover, clustered by theme (deterministic; works with no DB via the
//          mock tickets + lexical retriever).
//   POST → two human-driven steps, neither of which publishes anything:
//            { action: 'draft',   theme }  → draft a reviewable article for a gap
//                                            (LLM body only when the Brain is on),
//                                            enriching examples with each ticket's
//                                            recorded resolution.
//            { action: 'propose', ... }    → persist the reviewed draft as a
//                                            proposal (kind:'kb-article') in the
//                                            approval queue. NEVER writes content/kb
//                                            or hermes.kb_chunks — publishing is a
//                                            future human-approved wiring step.
//
// Mock-safe: with no DB, GET returns gaps computed over the mock ticket set and
// POST 'propose' degrades to a no-op proposal id (saveProposal returns null).
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { getTicketsByKind, getTicketComments } from '@/lib/data';
import type { TicketKind } from '@/lib/mock';
import { detectGaps, type ResolvedTicketLike } from '@/lib/kb-authoring/gaps';
import { draftArticle, type DraftExample, type KbCategory } from '@/lib/kb-authoring/draft';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { saveProposal } from '@/lib/hermes/proposals';

export const dynamic = 'force-dynamic';

const KINDS: TicketKind[] = ['incident', 'request', 'change', 'problem', 'release'];

// Terminal / resolved statuses across every ITIL kind (see mock.KIND_STATUSES).
// A ticket in one of these is "answered" — a fair source of a KB question.
const DONE = new Set([
  'resolved', 'closed', 'fulfilled', 'implemented', 'known_error', 'deployed', 'verified', 'done',
]);

async function getResolvedTickets(): Promise<ResolvedTicketLike[]> {
  const perKind = await Promise.all(KINDS.map((k) => getTicketsByKind(k)));
  const out: ResolvedTicketLike[] = [];
  for (const res of perKind) {
    for (const t of res.rows) {
      if (DONE.has((t.status ?? '').toLowerCase())) {
        out.push({ ref: t.ref, title: t.title, description: t.description });
      }
    }
  }
  return out;
}

// The recorded resolution of a ticket = its last reply/update comment body,
// falling back to the newest comment. Empty when there's no DB / no comments.
async function resolutionFor(ref: string): Promise<string | null> {
  try {
    const comments = await getTicketComments(ref);
    if (!comments.length) return null;
    const preferred = [...comments]
      .reverse()
      .find((c) => c.kind === 'reply' || c.kind === 'resolution' || c.kind === 'update');
    return (preferred ?? comments[comments.length - 1]).body || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  try {
    const tickets = await getResolvedTickets();
    const gaps = await detectGaps(tickets);
    return NextResponse.json({
      ok: true,
      gaps,
      resolvedCount: tickets.length,
      brainEnabled: brainEnabled(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Failed to detect KB gaps' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as any;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const action = body.action;

  // --- Draft an article for a gap (no persistence, just a preview) -----------
  if (action === 'draft') {
    const theme = typeof body.theme === 'string' ? body.theme : '';
    if (!theme) return NextResponse.json({ ok: false, error: 'theme is required' }, { status: 400 });
    try {
      const tickets = await getResolvedTickets();
      const gaps = await detectGaps(tickets);
      const gap = gaps.find((g) => g.theme === theme);
      if (!gap) return NextResponse.json({ ok: false, error: 'gap not found' }, { status: 404 });

      // Enrich each example with its recorded resolution to ground the draft.
      const examples: DraftExample[] = await Promise.all(
        gap.exampleTickets.map(async (e) => ({
          ref: e.ref,
          title: e.title,
          question: e.question,
          resolution: await resolutionFor(e.ref),
        })),
      );

      const article = await draftArticle({
        theme: gap.theme,
        suggestedTitle: gap.suggestedTitle,
        examples,
      });

      return NextResponse.json({
        ok: true,
        article,
        gap: { theme: gap.theme, exampleRefs: gap.exampleTickets.map((e) => e.ref) },
      });
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e?.message ?? 'Failed to draft article' },
        { status: 500 },
      );
    }
  }

  // --- Propose the reviewed draft to the KB (approval queue) -----------------
  if (action === 'propose') {
    const article = body.article;
    if (!article || typeof article.bodyMarkdown !== 'string' || typeof article.title !== 'string') {
      return NextResponse.json({ ok: false, error: 'article is required' }, { status: 400 });
    }
    const category: KbCategory =
      ['Technical', 'Billing', 'Onboarding', 'Security'].includes(article.category)
        ? article.category
        : 'Technical';
    const exampleRefs: string[] = Array.isArray(body.exampleRefs)
      ? body.exampleRefs.filter((r: unknown): r is string => typeof r === 'string')
      : [];

    let by = 'operator';
    try {
      const { userId } = await getSessionAccess();
      if (userId) by = userId;
    } catch {
      /* best-effort audit label */
    }

    // ref is intentionally BLANK: a kb-article proposal is not tied to a ticket,
    // so approving it must never post the article body as a ticket comment. The
    // approve→publish path for kind:'kb-article' is FUTURE WIRING — for now this is
    // a reviewable draft in the queue. The source ticket refs live in `sources`.
    const proposalId = await saveProposal({
      ref: '',
      agent: 'kb-authoring',
      kind: 'kb-article',
      title: article.title,
      summary:
        typeof article.summary === 'string' && article.summary
          ? article.summary
          : `Proposed KB article (${category})`,
      proposal: {
        ok: true,
        configured: true,
        classification: `KB article · ${category}`,
        draft: article.bodyMarkdown,
        reasoning: typeof article.summary === 'string' ? article.summary : undefined,
        sources: [`slug:${article.slug ?? ''}`, ...exampleRefs],
      },
    });

    return NextResponse.json({
      ok: true,
      proposalId,
      persisted: proposalId != null,
      by,
    });
  }

  return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
}
