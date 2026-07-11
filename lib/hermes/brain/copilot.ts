// The COPILOT runner — one entry point that runs any of the five department
// copilot personas (support/incident/escalation/billing/security) on the shared
// Brain and adapts the result back into a HermesProposal, so the Approvals queue,
// the ticket UI, and agent-meta all keep working unchanged.
//
// Why not the full LangGraph loop? These personas are DRAFT-ONLY: they produce a
// strict-JSON proposal and never execute a tool (their tools are seeded
// draft_only in the autonomy store). So a single Brain model turn — persona SOUL
// + KB grounding + the ticket — is the faithful, behaviour-preserving port of the
// old *-agent.ts modules. It reuses the Brain's model routing (brain/model.ts →
// getHermesRuntimeConfig) and persona registry, i.e. the same brain the PA uses.
//
// NOT gated by HERMES_BRAIN_ENABLED: the copilots are the existing, shipped
// product surface and must keep working with the flag off. Only the agentic PA
// (tool execution / interrupts) lives behind the flag.
import 'server-only';
import { callModel, type ChatMsg } from './model';
import { getPersona } from './personas';
import { retrieveKb } from '@/lib/hermes/kb-context';
import type { HermesProposal } from '@/lib/hermes/types';

export type CopilotPersonaId =
  | 'support'
  | 'incident'
  | 'escalation'
  | 'billing'
  | 'security';

export type CopilotInput = {
  ref: string;
  title: string;
  description?: string;
  priority?: string;
  status?: string;
};

// Extract a JSON object from model output that may be wrapped in ``` fences or
// preceded/followed by prose. Returns null if no balanced object is found.
// (Identical to the parser the five *-agent.ts modules used.)
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

/**
 * Run a department copilot persona over a ticket and return a HermesProposal.
 * Behaviour-preserving replacement for draftSupportReply / assessIncident /
 * draftEscalation / assessBilling / assessSecurity.
 */
export async function runCopilotProposal(opts: {
  persona: CopilotPersonaId;
  input: CopilotInput;
}): Promise<HermesProposal> {
  const { input } = opts;
  // `configured` mirrors the legacy agents (drives graceful UI degradation).
  const configured = Boolean(process.env.OPENROUTER_API_KEY);

  const persona = getPersona(opts.persona);
  if (!persona || !persona.copilot) {
    return { ok: false, configured, error: `unknown copilot persona: ${opts.persona}` };
  }
  const meta = persona.copilot;

  // Ground the draft in the KB exactly as the standalone agents did.
  const kb = await retrieveKb(`${input.title} ${input.description ?? ''}`);

  const userMessage = [
    meta.userLead,
    '',
    `Ref: ${input.ref}`,
    `Title: ${input.title}`,
    input.description ? `Description: ${input.description}` : 'Description: (none provided)',
    `${meta.priorityLabel}: ${input.priority ?? 'unset'}`,
    `Current status: ${input.status ?? 'unset'}`,
  ].join('\n');

  const messages: ChatMsg[] = [{ role: 'system', content: persona.systemPrompt }];

  if (kb.length > 0) {
    const kbBlock = [
      meta.kbHeader,
      '',
      ...kb.map((a) => `### ${a.title} (slug: ${a.slug})\n${a.body}`),
      '',
      meta.kbClosing,
    ].join('\n');
    messages.push({ role: 'system', content: kbBlock });
  }

  messages.push({ role: 'user', content: userMessage });

  // Draft-only: no tools are offered to the model, so it returns the strict JSON
  // proposal (never a tool call) — preserving the exact HermesProposal contract.
  const result = await callModel({ messages, model: persona.model });

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
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
    model: result.model,
  };
}
