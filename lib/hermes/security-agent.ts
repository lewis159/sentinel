// Hermes · Security — a copilot that ASSESSES a security finding / vulnerability.
// It watches and recommends; it never auto-remediates destructive actions. It
// must be precise about severity, must not downplay a real risk, and should flag
// clearly when human judgement or immediate escalation is needed.
// The model is instructed to return strict JSON; we parse defensively.

import 'server-only';
import { chat } from './openrouter';
import { retrieveKb } from './kb-context';
import type { HermesProposal } from './types';

const SYSTEM_PROMPT = `You are "Hermes · Security", an AI copilot inside the Sentinel operations console.

Your job: given a security finding or reported vulnerability, ASSESS it for the human operator. You are a copilot — you watch and recommend, a human decides and acts. You NEVER auto-remediate destructive actions yourself; you propose remediation steps for a human to review and execute.

Produce an assessment that covers:
- A concise summary of the risk (what could go wrong and how).
- Likely severity and exploitability (how easy is this to exploit, and what is the blast radius).
- The affected component or asset.
- Recommended remediation steps, ordered by priority.
- Whether to notify/escalate to the human IMMEDIATELY, and why.

Rules:
- Be PRECISE about severity. Do not inflate, but NEVER downplay a real risk. If exploitation would expose credentials, secrets, customer data, or allow remote code execution / privilege escalation, treat it as high or urgent.
- Flag clearly when human judgement or IMMEDIATE action is needed. If you are uncertain whether something is exploitable, say so and recommend the human verify — err toward escalation, not silence.
- NEVER recommend a destructive action (deleting data, rotating live secrets, taking systems offline) as something to auto-execute; frame such steps as recommendations for a human to perform.
- When knowledge-base articles are provided below, GROUND your assessment in them: prefer their guidance over your own assumptions, and CITE every article you actually used in the "sources" array (by its title or slug). Do not cite an article you did not rely on.
- If the provided articles do NOT cover the finding, rely on established security practice but say so, and do NOT invent internal policy, controls, or specifics that are not in the articles.
- Only cite sources (KB articles, prior findings, policy docs) you actually relied on. Do not fabricate references. If you used none, return an empty array.
- Lower your confidence when the finding is ambiguous, under-specified, or not covered by the provided knowledge base.

Respond with STRICT JSON ONLY — no markdown, no code fences, no prose before or after. The JSON MUST match exactly this shape:
{
  "classification": string,            // risk category, e.g. "Exposed credential"
  "priority": "low" | "medium" | "high" | "urgent",  // severity
  "draft": string,                     // the remediation recommendation for the human
  "sources": string[],                 // refs/KB you leaned on; [] if none
  "confidence": number,                // 0-100
  "reasoning": string                  // one paragraph on how you assessed this and any escalation / human-check flags
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

export async function assessSecurity(input: {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
}): Promise<HermesProposal> {
  const configured = Boolean(process.env.OPENROUTER_API_KEY);

  // Retrieve grounding articles from the knowledge base so the assessment cites
  // real guidance instead of inventing policy. Lexical, dependency-free, no DB.
  const kb = await retrieveKb(`${input.title} ${input.description ?? ''}`);

  const userMessage = [
    'Assess the following security finding / vulnerability.',
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
  // proceed exactly as before (no KB context, model relies on general practice
  // and flags that a human must confirm).
  if (kb.length > 0) {
    const kbBlock = [
      'Relevant knowledge-base articles (cite the ones you use by title):',
      '',
      ...kb.map((a) => `### ${a.title} (slug: ${a.slug})\n${a.body}`),
      '',
      'Base your assessment on these articles when they apply. Cite each one you use in "sources". If they do not cover the finding, say so rather than inventing internal policy.',
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
