// Persona registry for the Brain. A persona bundles: an id, a SOUL system
// prompt, the tools it's allowed to call, an optional per-persona model override,
// and a default autonomy override per tool (so the same tool can be, say, gated
// for one persona and auto for another). P0 ships one persona: `pa`.
import type { ToolAutonomy } from './tools/types';
import { PA_SOUL } from './personas/pa';
import { COPILOT_PERSONAS, type CopilotMeta } from './personas/copilots';
import { EXEC_PERSONAS } from './personas/execs';
import { KNOWLEDGE_SYSTEM_PROMPT } from './personas/knowledge';

export type Persona = {
  id: string;
  systemPrompt: string;
  allowedTools: string[] | '*';
  // Optional per-persona autonomy overrides, keyed by tool name. When absent,
  // the tool's own `autonomy` is used.
  autonomyByTool?: Record<string, ToolAutonomy>;
  // Optional OpenRouter model override; falls back to the configured global model.
  model?: string;
  // Marks an ADVISORY-ONLY persona (e.g. Risk / Red-team) that must never carry a
  // side-effecting tool. This is documentation of intent — the actual guarantee is
  // that `allowedTools` contains no gated/side-effecting tool, so the graph never
  // offers one to the model. Kept in sync with that invariant by the persona tests.
  advisory?: boolean;
  // Present on the five DRAFT-ONLY department copilots (support/incident/
  // escalation/billing/security). Carries how their user turn + KB block are
  // phrased so the runner (brain/copilot.ts) reproduces each draft verbatim.
  copilot?: CopilotMeta;
};

export const PA_PERSONA: Persona = {
  id: 'pa',
  systemPrompt: PA_SOUL,
  allowedTools: ['getTicket', 'listTickets', 'updateTicket', 'broadcastStatus', 'getDeployStatus'],
  // updateTicket stays gated (the P0 demo side-effect); everything else auto.
  autonomyByTool: { updateTicket: 'gated' },
  model: process.env.HERMES_PA_MODEL || undefined,
};

// The five department copilots, registered from personas/copilots.ts. Each has a
// per-persona model override env (HERMES_<ID>_MODEL) but defaults to the global.
const COPILOT_PERSONA_LIST: Persona[] = COPILOT_PERSONAS.map((c) => ({
  id: c.id,
  systemPrompt: c.systemPrompt,
  allowedTools: c.allowedTools,
  // Carry each copilot's per-tool autonomy overrides (e.g. Support → updateTicket
  // gated) so the graph gates the same way it does for the PA.
  autonomyByTool: c.autonomyByTool,
  copilot: c.copilot,
  model: process.env[`HERMES_${c.id.toUpperCase()}_MODEL`] || undefined,
}));

// Internal Knowledge Q&A — a READ-ONLY, ADVISORY persona. Empty tool set means the
// Brain graph never offers it a side-effecting tool; it only answers questions,
// grounded strictly in the estate context the runner hands it. See
// lib/hermes/brain/knowledge.ts (answerKnowledgeQuestion) for the grounded runner.
export const KNOWLEDGE_PERSONA: Persona = {
  id: 'knowledge',
  systemPrompt: KNOWLEDGE_SYSTEM_PROMPT,
  allowedTools: [],
  advisory: true,
  model: process.env.HERMES_KNOWLEDGE_MODEL || undefined,
};

const PERSONAS = new Map<string, Persona>([
  [PA_PERSONA.id, PA_PERSONA],
  [KNOWLEDGE_PERSONA.id, KNOWLEDGE_PERSONA],
  ...COPILOT_PERSONA_LIST.map((p): [string, Persona] => [p.id, p]),
  // CEO / Chief-of-Staff + Risk / Red-team — the two remaining execs that
  // complete the roster. Agentic personas (like the PA), read-only tool sets.
  ...EXEC_PERSONAS.map((p): [string, Persona] => [p.id, p]),
]);

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.get(id);
}

// Resolve the effective autonomy for a tool under a persona (override → default).
export function autonomyFor(persona: Persona, toolName: string, toolDefault: ToolAutonomy): ToolAutonomy {
  return persona.autonomyByTool?.[toolName] ?? toolDefault;
}
