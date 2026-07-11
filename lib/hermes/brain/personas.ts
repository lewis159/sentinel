// Persona registry for the Brain. A persona bundles: an id, a SOUL system
// prompt, the tools it's allowed to call, an optional per-persona model override,
// and a default autonomy override per tool (so the same tool can be, say, gated
// for one persona and auto for another). P0 ships one persona: `pa`.
import type { ToolAutonomy } from './tools/types';
import { PA_SOUL } from './personas/pa';

export type Persona = {
  id: string;
  systemPrompt: string;
  allowedTools: string[] | '*';
  // Optional per-persona autonomy overrides, keyed by tool name. When absent,
  // the tool's own `autonomy` is used.
  autonomyByTool?: Record<string, ToolAutonomy>;
  // Optional OpenRouter model override; falls back to the configured global model.
  model?: string;
};

export const PA_PERSONA: Persona = {
  id: 'pa',
  systemPrompt: PA_SOUL,
  allowedTools: ['getTicket', 'listTickets', 'updateTicket', 'broadcastStatus', 'getDeployStatus'],
  // updateTicket stays gated (the P0 demo side-effect); everything else auto.
  autonomyByTool: { updateTicket: 'gated' },
  model: process.env.HERMES_PA_MODEL || undefined,
};

const PERSONAS = new Map<string, Persona>([[PA_PERSONA.id, PA_PERSONA]]);

export function getPersona(id: string): Persona | undefined {
  return PERSONAS.get(id);
}

// Resolve the effective autonomy for a tool under a persona (override → default).
export function autonomyFor(persona: Persona, toolName: string, toolDefault: ToolAutonomy): ToolAutonomy {
  return persona.autonomyByTool?.[toolName] ?? toolDefault;
}
