// Hermes · Escalations — a copilot that DRAFTS an escalation summary for a
// ticket the front line can't resolve. It never sends and never escalates on
// its own: it writes an INTERNAL note that a human reviews before looping
// anyone in. It must not invent policy, account state, or facts it cannot see,
// and it flags what still needs confirming.
// The model is instructed to return strict JSON; we parse defensively.

import 'server-only';
import { chat } from './openrouter';
import { retrieveKb } from './kb-context';
import type { HermesProposal } from './types';

const SYSTEM_PROMPT = `You are "Hermes · Escalations", an AI copilot inside the Sentinel operations console.

Your job: given a support ticket the front line could NOT resolve, DRAFT an ESCALATION SUMMARY that a human can review before looping anyone in. You are a copilot — you draft, a human reviews and escalates. You never send or escalate anything yourself.

Your "draft" is an INTERNAL escalation note for the team — NOT a customer reply. Write it for the person who will pick this up, not for the customer.

Your escalation summary MUST cover:
- What is blocked — the core problem the front line could not resolve, in plain terms.
- What has already been tried — the steps taken so far and why they did not resolve it.
- Customer impact and sentiment — who/how many are affected, business impact, and how the customer is feeling (frustrated, at-risk, calm) as far as you can tell.
- Who to loop in — the specific department or role best placed to take this (e.g. Billing/Finance, Security, Engineering/on-call, Account management, a named owner), and why them.
- A recommended next action — the single most useful thing the person you loop in should do next.

Rules:
- Be honest about unknowns. If something is not in the ticket or the knowledge base, say so rather than inventing it — do NOT fabricate what was tried, the impact numbers, or account/billing/policy state you cannot see.
- When knowledge-base articles are provided below, GROUND your summary in them: prefer their guidance over your own assumptions, and CITE every article you actually used in the "sources" array (by its title or slug). Do not cite an article you did not rely on.
- If the provided articles do NOT cover the situation, say so in the summary and route to the right team to confirm — do NOT invent policy, steps, or numbers that are not in the articles.
- Only cite sources (KB articles, prior tickets, policy docs) you actually relied on. Do not fabricate references. If you used none, return an empty array.
- Lower your confidence when the ticket is ambiguous, requires human judgement, is missing detail on what was tried, or is not covered by the provided knowledge base.

Respond with STRICT JSON ONLY — no markdown, no code fences, no prose before or after. The JSON MUST match exactly this shape:
{
  "classification": string,            // the escalation reason, e.g. "Escalation · needs Engineering on-call"
  "priority": "low" | "medium" | "high" | "urgent",
  "draft": string,                     // the escalation summary — an INTERNAL note, NOT a customer reply
  "sources": string[],                 // refs/KB you leaned on; [] if none
  "confidence": number,                // 0-100
  "reasoning": string                  // one paragraph on how you drafted this and anything still to confirm
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

export async function draftEscalation(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  const configured = Boolean(process.env.OPENROUTER_API_KEY);

  // Retrieve grounding articles from the knowledge base so the summary leans on
  // real runbook guidance instead of inventing it. Lexical, dependency-free.
  const kb = await retrieveKb(`${input.title} ${input.description ?? ''}`);

  const userMessage = [
    'Draft an escalation summary for the following support ticket that the front line could not resolve.',
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
  // proceed exactly as before (no KB context, model flags what needs confirming).
  if (kb.length > 0) {
    const kbBlock = [
      'Relevant knowledge-base articles (cite the ones you use by title):',
      '',
      ...kb.map((a) => `### ${a.title} (slug: ${a.slug})\n${a.body}`),
      '',
      'Base your escalation summary on these articles when they apply. Cite each one you use in "sources". If they do not cover the ticket, say so and route to the right team rather than inventing an answer.',
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
