// Persona registry for the Brain. A persona bundles: an id, a SOUL system
// prompt, the tools it's allowed to call, an optional per-persona model override,
// and a default autonomy override per tool (so the same tool can be, say, gated
// for one persona and auto for another). P0 ships one persona: `pa`.
import type { ToolAutonomy } from './tools/types';
import { PA_SOUL } from './personas/pa';
import { COPILOT_PERSONAS, type CopilotMeta } from './personas/copilots';

export type Persona = {
  id: string;
  systemPrompt: string;
  allowedTools: string[] | '*';
  // Optional per-persona autonomy overrides, keyed by tool name. When absent,
  // the tool's own `autonomy` is used.
  autonomyByTool?: Record<string, ToolAutonomy>;
  // Optional OpenRouter model override; falls back to the configured global model.
  model?: string;
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
  copilot: c.copilot,
  model: process.env[`HERMES_${c.id.toUpperCase()}_MODEL`] || undefined,
}));

const PERSONAS = new Map<string, Persona>([
  [PA_PERSONA.id, PA_PERSONA],
  ...COPILOT_PERSONA_LIST.map((p): [string, Persona] => [p.id, p]),
]);

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.get(id);
}

// Resolve the effective autonomy for a tool under a persona (override → default).
export function autonomyFor(persona: Persona, toolName: string, toolDefault: ToolAutonomy): ToolAutonomy {
  return persona.autonomyByTool?.[toolName] ?? toolDefault;
}
