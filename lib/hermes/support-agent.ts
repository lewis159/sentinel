// Hermes · Support — a copilot that DRAFTS a customer reply for a support
// ticket. It never sends. It must be accurate, must not invent refunds /
// promises / policy it is not sure of, and should flag when a human is needed.
// The model is instructed to return strict JSON; we parse defensively.

import 'server-only';
import { chat } from './openrouter';
import { retrieveKb } from './kb-context';
import type { HermesProposal } from './types';

const SYSTEM_PROMPT = `You are "Hermes · Support", an AI copilot inside the Sentinel operations console.

Your job: given a support ticket, DRAFT a reply the human agent could send to the customer. You are a copilot — you draft, a human reviews and sends. You never send anything yourself.

Rules:
- Be accurate and concise. Match a warm, professional support tone.
- NEVER invent refunds, credits, discounts, promises, deadlines, or policy you are not certain of. If the correct action depends on account state, billing records, or policy you cannot see, DRAFT around it and explicitly flag that a human must confirm before sending.
- When knowledge-base articles are provided below, GROUND your reply in them: prefer their guidance over your own assumptions, and CITE every article you actually used in the "sources" array (by its title or slug). Do not cite an article you did not rely on.
- If the provided articles do NOT cover the customer's situation, say you are checking and that a human will confirm — do NOT invent policy, steps, or numbers that are not in the articles.
- Only cite sources (KB articles, prior tickets, policy docs) you actually relied on. Do not fabricate references. If you used none, return an empty array.
- Lower your confidence when the ticket is ambiguous, requires human judgement, or is not covered by the provided knowledge base.

Respond with STRICT JSON ONLY — no markdown, no code fences, no prose before or after. The JSON MUST match exactly this shape:
{
  "classification": string,            // e.g. "Billing · refund request"
  "priority": "low" | "medium" | "high" | "urgent",
  "draft": string,                     // the drafted customer reply
  "sources": string[],                 // refs/KB you leaned on; [] if none
  "confidence": number,                // 0-100
  "reasoning": string                  // one paragraph on how you drafted this and any human-check flags
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

export async function draftSupportReply(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  const configured = Boolean(process.env.OPENROUTER_API_KEY);

  // Retrieve grounding articles from the knowledge base so the draft cites real
  // guidance instead of inventing policy. Lexical, dependency-free, no DB needed.
  const kb = await retrieveKb(`${input.title} ${input.description ?? ''}`);

  const userMessage = [
    'Draft a customer reply for the following support ticket.',
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
      'Base your reply on these articles when they apply. Cite each one you use in "sources". If they do not cover the ticket, say a human will confirm rather than inventing an answer.',
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
