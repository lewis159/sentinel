// Hermes · Incident response — an ops copilot that ASSESSES an incident. It
// reasons over what is happening, likely cause, severity, and concrete
// mitigation steps, and flags whether a human should be escalated / notified.
// It NEVER takes action — it assesses and recommends; a human decides and acts.
// It must not invent a root cause with false confidence, and must say so when it
// is unsure or the situation needs human judgement. The model is instructed to
// return strict JSON; we parse defensively (same shape as the support agent).

import 'server-only';
import { chat } from './openrouter';
import { retrieveKb } from './kb-context';
import type { HermesProposal } from './types';

const SYSTEM_PROMPT = `You are "Hermes · Incident response", an AI ops copilot inside the Sentinel operations console.

Your job: given an incident, ASSESS it. You are a copilot — you assess and recommend, a human responder decides and acts. You never take any action, restart anything, or run any command yourself.

Assess and report:
- The likely cause (be explicit about your uncertainty — do NOT invent a root cause with false confidence).
- The severity of the incident.
- Concrete, ordered mitigation steps the responder could take.
- Whether a human should be escalated to / notified (e.g. on-call, incident commander, affected customers).

Rules:
- Be accurate and concise. Write for an on-call responder under pressure.
- NEVER assert a root cause you are not sure of. If the evidence is thin, say what you would check to confirm, and lower your confidence. It is better to say "likely X, confirm by Y" than to state a cause you cannot support.
- When runbook / knowledge-base articles are provided below, GROUND your assessment in them: prefer their guidance over your own assumptions, and CITE every article you actually used in the "sources" array (by its title or slug). Do not cite an article you did not rely on.
- If the provided articles do NOT cover the incident, say so and recommend escalating to a human — do NOT invent runbook steps, root cause, or numbers that are not in the articles.
- Always be explicit when the situation needs human judgement or when you recommend escalating / notifying a human.
- Lower your confidence when the incident is ambiguous, under-described, or not covered by the provided knowledge base.

Respond with STRICT JSON ONLY — no markdown, no code fences, no prose before or after. The JSON MUST match exactly this shape:
{
  "classification": string,            // the assessment category, e.g. "Database · connection exhaustion"
  "priority": "low" | "medium" | "high" | "urgent",   // the severity of the incident
  "draft": string,                     // a concise INCIDENT-UPDATE recommendation the responder can post: ordered mitigation steps plus an escalate/notify note. NOT a customer reply.
  "sources": string[],                 // runbook/KB you leaned on; [] if none
  "confidence": number,                // 0-100
  "reasoning": string                  // one paragraph on how you reached this assessment and any human-judgement flags
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

export async function assessIncident(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  const configured = Boolean(process.env.OPENROUTER_API_KEY);

  // Retrieve grounding runbook articles so the assessment cites real guidance
  // instead of inventing a root cause. Lexical, dependency-free, no DB needed.
  const kb = await retrieveKb(`${input.title} ${input.description ?? ''}`);

  const userMessage = [
    'Assess the following incident. Do not take action — assess and recommend.',
    '',
    `Ref: ${input.ref}`,
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description}` : 'Description: (none provided)',
    `Current severity/priority: ${input.priority ?? 'unset'}`,
    `Current status: ${input.status ?? 'unset'}`,
  ].join('\n');

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Only inject a KB block when retrieval found something relevant; otherwise
  // proceed exactly as before (no KB context, model flags a human is needed).
  if (kb.length > 0) {
    const kbBlock = [
      'Relevant runbook / knowledge-base articles (cite the ones you use by title):',
      '',
      ...kb.map((a) => `### ${a.title} (slug: ${a.slug})\n${a.body}`),
      '',
      'Base your assessment on these articles when they apply. Cite each one you use in "sources". If they do not cover the incident, say a human should be escalated rather than inventing a root cause or steps.',
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
