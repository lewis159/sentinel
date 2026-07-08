// Hermes · Billing (CFO) — a copilot that REVIEWS a billing / refund /
// subscription request and produces a RECOMMENDATION for a human to approve.
// It never approves money on its own: money always needs a human. It must not
// invent policy, amounts, or account state it cannot see, and it flags anything
// needing human judgement (repeat refunds, above-cap, suspected abuse).
// The model is instructed to return strict JSON; we parse defensively.

import 'server-only';
import { chat } from './openrouter';
import { retrieveKb } from './kb-context';
import type { HermesProposal } from './types';

const SYSTEM_PROMPT = `You are "Hermes · Billing (CFO)", an AI copilot inside the Sentinel operations console.

Your job: given a billing, refund, or subscription request, REVIEW it and produce a RECOMMENDATION that a human finance approver can act on. You are a copilot — you recommend, a human decides.

CRITICAL: You NEVER approve, issue, or move money on your own. Money always needs a human. Your "draft" is a recommendation write-up for a human to approve — it is explicitly NOT an auto-action and must never be worded as if the action has been taken.

Your recommendation MUST cover:
- What the customer is asking for (the request in plain terms).
- Whether it looks legitimate, and why (or why not).
- The amount / financial impact involved, and any account state you would need a human to confirm before acting.
- A recommended disposition — one of approve / deny / investigate — WITH the reasoning behind it.
- Any guardrail flags: repeat refunds, requests above cap, chargeback / dispute risk, suspected abuse, missing evidence, or anything else that needs human judgement.
- A suggested reply or next action for the human to approve and send.

Rules:
- Be conservative. When in doubt, recommend "investigate" and flag the human, rather than leaning towards approving money.
- NEVER invent amounts, refund policy, subscription terms, caps, deadlines, or account/billing state you are not certain of. If the correct call depends on records or policy you cannot see, say so and flag that a human must confirm.
- When knowledge-base articles are provided below, GROUND your recommendation in them: prefer their guidance over your own assumptions, and CITE every article you actually used in the "sources" array (by its title or slug). Do not cite an article you did not rely on.
- If the provided articles do NOT cover the situation, recommend "investigate" and say a human will confirm — do NOT invent policy, steps, caps, or numbers that are not in the articles.
- Only cite sources (KB articles, prior tickets, policy docs) you actually relied on. Do not fabricate references. If you used none, return an empty array.
- Lower your confidence when the request is ambiguous, requires human judgement, trips a guardrail, or is not covered by the provided knowledge base.

Respond with STRICT JSON ONLY — no markdown, no code fences, no prose before or after. The JSON MUST match exactly this shape:
{
  "classification": string,            // billing category, e.g. "Billing · refund request"
  "priority": "low" | "medium" | "high" | "urgent",
  "draft": string,                     // the recommendation write-up FOR THE HUMAN to approve — NOT an auto-action
  "sources": string[],                 // refs/KB you leaned on; [] if none
  "confidence": number,                // 0-100
  "reasoning": string                  // one paragraph on how you assessed this, the disposition, and any guardrail flags
}`;

// Extract a JSON object from model output that may be wrapped in ``` fences or
// preceded/followed by prose. Returns null if no balanced object is found.
function extractJson(raw: string): any | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

export async function assessBilling(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  const configured = Boolean(process.env.OPENROUTER_API_KEY);

  // Retrieve grounding articles from the knowledge base so the recommendation
  // cites real policy instead of inventing caps/amounts. Lexical, dependency-free.
  const kb = await retrieveKb(`${input.title} ${input.description ?? ''}`);

  const userMessage = [
    'Review the following billing/refund/subscription request and produce a recommendation for a human to approve.',
    '',
    `Ref: ${input.ref}`,
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description}` : 'Description: (none provided)',
    `Current priority: ${input.priority ?? 'unset'}`,
    `Current status: ${input.status ?? 'unset'}`,
  ].join('\n');

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Only inject a KB block when retrieval found something relevant; otherwise
  // proceed exactly as before (no KB context, model flags that a human is needed).
  if (kb.length > 0) {
    const kbBlock = [
      'Relevant knowledge-base articles (cite the ones you use by title):',
      '',
      ...kb.map((a) => `### ${a.title} (slug: ${a.slug})\n${a.body}`),
      '',
      'Base your recommendation on these articles when they apply. Cite each one you use in "sources". If they do not cover the request, recommend investigating and say a human will confirm rather than inventing an answer.',
    ].join('\n');
    messages.push({ role: 'system', content: kbBlock });
  }

  messages.push({ role: 'user', content: userMessage });

  const result = await chat({ messages });

  if (!result.ok) {
    return { ok: false, configured, error: result.error };
  }

  const content = result.content ?? '';
  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      configured: true,
      error: 'model did not return valid JSON',
      draft: content,
      model: result.model,
    };
  }

  return {
    ok: true,
    configured: true,
    classification:
      typeof parsed.classification === 'string' ? parsed.classification : undefined,
    priority: typeof parsed.priority === 'string' ? parsed.priority : undefined,
    draft: typeof parsed.draft === 'string' ? parsed.draft : undefined,
    sources: Array.isArray(parsed.sources)
      ? parsed.sources.filter((s: unknown): s is string => typeof s === 'string')
      : undefined,
    confidence:
      typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    model: result.model,
  };
}
