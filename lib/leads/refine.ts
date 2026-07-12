// Sales / Lead-qualification — OPTIONAL LLM refinement + grounded pre-sale reply.
//
// Kept SEPARATE from ./qualify.ts so the deterministic scorer stays a pure,
// model-free function. Everything here is gated behind brainEnabled(): with the
// Brain flag OFF this module is never called and the surface runs on the
// deterministic score alone.
//
// Two jobs, both DRAFT-ONLY (nothing is ever sent):
//   1. refineAssessment() — a single model turn that reviews the deterministic
//      read and returns an optional tier override + a one-line rationale.
//   2. draftPresaleReply() — retrieves KB snippets (retrieveKb) and drafts a
//      GROUNDED answer to the lead's pre-sale question. Falls back to a template
//      built from the retrieved snippets when the model is off/unavailable, so a
//      reply draft is always producible for the gated approval queue.
import 'server-only';
import { callModel } from '@/lib/hermes/brain/model';
import { retrieveKb, type KbSnippet } from '@/lib/hermes/kb-context';
import type { LeadAssessment, LeadInput, LeadTier } from './qualify';

const TIERS: LeadTier[] = ['hot', 'warm', 'cold'];

function extractJson(raw: string): any | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type LeadRefinement = {
  tier?: LeadTier;      // model's suggested tier (advisory — never auto-applied to routing)
  summary?: string;     // one-line qualification rationale
  model?: string;
};

/**
 * Ask the model to sanity-check the deterministic assessment. Advisory only —
 * the caller decides whether to surface the suggested tier. Returns {} on any
 * failure (model off, parse error) so callers degrade to the deterministic read.
 */
export async function refineAssessment(
  input: LeadInput,
  base: LeadAssessment,
): Promise<LeadRefinement> {
  const messages = [
    {
      role: 'system' as const,
      content:
        'You are a B2B SaaS sales-development rep for Scribuo. You review an inbound ' +
        'lead and its rule-based qualification, then return STRICT JSON only: ' +
        '{"tier":"hot|warm|cold","summary":"<=1 sentence why"}. Do not add prose.',
    },
    {
      role: 'user' as const,
      content: [
        `Company: ${input.company ?? '(none)'}`,
        `Email: ${input.email ?? '(none)'}`,
        `Source: ${input.source ?? '(none)'}`,
        `Message: ${input.message ?? '(none)'}`,
        '',
        `Rule-based score: ${base.score}/100 → ${base.tier}`,
        `Rule signals: ${base.reasons.join('; ')}`,
      ].join('\n'),
    },
  ];

  const res = await callModel({ messages, temperature: 0.2, maxTokens: 300 });
  if (!res.ok) return {};
  const parsed = extractJson(res.content ?? '');
  if (!parsed || typeof parsed !== 'object') return {};
  const tier = TIERS.includes(parsed.tier) ? (parsed.tier as LeadTier) : undefined;
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : undefined;
  return { tier, summary, model: res.model };
}

export type PresaleDraft = {
  draft: string;
  sources: KbSnippet[];  // KB articles the answer is grounded in
  grounded: boolean;     // true when at least one KB snippet matched
  model?: string;        // set when a model wrote the draft
};

/**
 * Draft a GROUNDED pre-sale answer to a lead's question. Retrieves KB context
 * first; when the Brain is on, the model writes a reply constrained to that
 * context. When the model is off/unavailable it falls back to a deterministic
 * template assembled from the retrieved snippets. Either way the result is a
 * DRAFT for the approval queue — never sent.
 */
export async function draftPresaleReply(opts: {
  question: string;
  name?: string | null;
  company?: string | null;
}): Promise<PresaleDraft> {
  const kb = await retrieveKb(opts.question, 3);
  const grounded = kb.length > 0;
  const who = (opts.name ?? '').trim() || 'there';

  // Deterministic fallback used when no model answers — grounded in the same KB.
  const templateFallback = (): string => {
    const intro = `Hi ${who}, thanks for reaching out to Scribuo.`;
    if (!grounded) {
      return (
        `${intro} Thanks for your question — I'd like to get you a precise answer, ` +
        `so a member of the team will follow up shortly with the detail you need.`
      );
    }
    const body = kb.map((a) => `• ${a.title}: ${a.body}`).join('\n\n');
    return (
      `${intro} Here's what should help:\n\n${body}\n\n` +
      `Happy to jump on a quick call if it's useful — just let me know.`
    );
  };

  const { brainEnabled } = await import('@/lib/hermes/brain/flags');
  if (!brainEnabled()) {
    return { draft: templateFallback(), sources: kb, grounded };
  }

  const kbBlock = grounded
    ? kb.map((a) => `### ${a.title} (slug: ${a.slug})\n${a.body}`).join('\n\n')
    : '(no relevant knowledge-base articles matched)';

  const messages = [
    {
      role: 'system' as const,
      content:
        'You are a friendly, concise B2B SaaS pre-sales rep for Scribuo. Draft a ' +
        'reply to a prospect using ONLY the knowledge-base context provided. If the ' +
        'context does not answer the question, say a team member will follow up — do ' +
        'NOT invent pricing, limits, or commitments. Plain text, no markdown headers.',
    },
    { role: 'system' as const, content: `KNOWLEDGE BASE:\n${kbBlock}` },
    {
      role: 'user' as const,
      content:
        `Prospect${opts.company ? ` from ${opts.company}` : ''} asks: ${opts.question}\n\n` +
        `Address them as "${who}". Draft the reply.`,
    },
  ];

  const res = await callModel({ messages, temperature: 0.3, maxTokens: 600 });
  if (!res.ok || !res.content?.trim()) {
    return { draft: templateFallback(), sources: kb, grounded };
  }
  return { draft: res.content.trim(), sources: kb, grounded, model: res.model };
}
