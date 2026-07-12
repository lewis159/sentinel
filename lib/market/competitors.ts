// Hermes · Market & Content — competitor "scan" → DRAFT competitive brief.
//
// A "scan" summarises a competitor's likely positioning / pricing shifts and a
// competitive takeaway. Two modes, same shape:
//
//   • Brain OFF (dormant) — a DETERMINISTIC brief assembled from the stored
//     operator notes in config.ts. No model, no DB, no network.
//   • Brain ON  — additionally asks the model to reason OVER THOSE STORED NOTES
//     for likely shifts + a takeaway. This is analysis-from-notes, explicitly
//     NOT live web data.
//
// ⚠️  NO LIVE FETCH. Web research is not available server-side here, so a scan
// never touches the competitor's site. Every brief is stamped "analysis from
// stored notes, not live web data". See the real-web-source TODO in config.ts —
// wiring a read-only search/SEO API is what would make a scan reflect reality.
//
// DRAFT-ONLY: a scan calls saveProposal(kind:'competitor-brief'). The proposal
// carries NO `action` and an EMPTY `ref`, so approving it can never post to a
// ticket or run a tool — it simply marks the brief reviewed. Nothing publishes.
import 'server-only';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { callModel } from '@/lib/hermes/brain/model';
import { saveProposal } from '@/lib/hermes/proposals';
import type { HermesProposal } from '@/lib/hermes/types';
import { getCompetitor, type Competitor } from './config';

const AGENT = 'market';

const NOT_LIVE =
  'Analysis from stored operator notes — NOT live web data. No competitor site was fetched.';

export type CompetitorBrief = {
  slug: string;
  name: string;
  url: string;
  positioning: string;
  pricingNotes: string;
  lastReviewed: string;
  analysis: string; // markdown body (deterministic or model-authored)
  analysisSource: 'model' | 'notes';
  configured: boolean;
  model?: string;
  disclaimer: string; // always the NOT_LIVE stamp
};

/** Deterministic brief straight from the stored notes (no model). */
function deterministicBrief(c: Competitor): string {
  return [
    `## Competitive brief — ${c.name}`,
    '',
    `> ${NOT_LIVE}`,
    '',
    `**Website:** ${c.url}`,
    `**Last reviewed by operator:** ${c.lastReviewed}`,
    '',
    '### Positioning (on file)',
    c.positioning,
    '',
    '### Pricing notes (on file)',
    c.pricingNotes,
    '',
    '### Takeaway',
    `No live-scan source is wired, so there is nothing new to report beyond the notes above. ` +
      `To detect real positioning/pricing shifts, wire a read-only web/SEO source (see config.ts TODO) ` +
      `and re-run with the Hermes Brain enabled for an analysis.`,
  ].join('\n');
}

/**
 * Scan a competitor → a DRAFT competitive brief. Never fetches the web.
 *
 *   • Always returns a brief (deterministic from notes when the brain is off or
 *     the model is unavailable).
 *   • With the brain on + a model configured, the analysis is model-authored
 *     reasoning over the stored notes.
 *
 * Pass `commit: true` (the default from the API) to persist the brief as a
 * `competitor-brief` proposal in the approval queue and get its id. Never
 * publishes anywhere.
 */
export async function scanCompetitor(input: {
  slug: string;
  commit?: boolean;
}): Promise<{ ok: boolean; error?: string; brief?: CompetitorBrief; proposalId?: string | null }> {
  const c = getCompetitor(input.slug);
  if (!c) return { ok: false, error: `unknown competitor: ${input.slug}` };

  let analysis = deterministicBrief(c);
  let analysisSource: CompetitorBrief['analysisSource'] = 'notes';
  let configured = false;
  let model: string | undefined;

  if (brainEnabled()) {
    const sys =
      'You are a competitive-intelligence analyst for Scribuo, a transcription/content SaaS. ' +
      'You are given a competitor and OPERATOR NOTES only — you have NO live web access. ' +
      'Reason ONLY over the notes. Do NOT invent current prices, features, or announcements. ' +
      'Clearly frame everything as "likely" / "based on stored notes". Output markdown.';
    const user =
      `Competitor: ${c.name} (${c.url})\n` +
      `Positioning (on file): ${c.positioning}\n` +
      `Pricing notes (on file): ${c.pricingNotes}\n` +
      `Last reviewed: ${c.lastReviewed}\n\n` +
      'Produce a short competitive brief with these sections:\n' +
      '1. Likely positioning shifts to watch for (framed as hypotheses to verify)\n' +
      '2. Likely pricing pressure or moves (from the notes only)\n' +
      '3. Competitive takeaway for Scribuo (how we differentiate / where we win)\n' +
      'Prefix the whole brief with a one-line note that this is analysis from stored notes, not live data.';

    const res = await callModel({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      maxTokens: 900,
    });

    if (res.ok && res.content.trim()) {
      analysis = `> ${NOT_LIVE}\n\n${res.content.trim()}`;
      analysisSource = 'model';
      configured = true;
      model = res.model;
    } else {
      configured = res.ok; // model configured but empty/failed → keep deterministic
    }
  }

  const brief: CompetitorBrief = {
    slug: c.slug,
    name: c.name,
    url: c.url,
    positioning: c.positioning,
    pricingNotes: c.pricingNotes,
    lastReviewed: c.lastReviewed,
    analysis,
    analysisSource,
    configured,
    model,
    disclaimer: NOT_LIVE,
  };

  let proposalId: string | null = null;
  if (input.commit) {
    const proposal: HermesProposal = {
      ok: true,
      configured,
      classification: `Market · competitor brief (${c.name})`,
      draft: analysis,
      sources: [c.url],
      reasoning: NOT_LIVE,
      model,
    };
    // Empty ref → approval can never post this to a ticket; briefs never publish.
    proposalId = await saveProposal({
      ref: '',
      agent: AGENT,
      kind: 'competitor-brief',
      title: `Competitive brief — ${c.name}`,
      summary: `Scan of ${c.name} (analysis from stored notes, not live web data)`,
      proposal,
    });
  }

  return { ok: true, brief, proposalId };
}
