// Tool registry for the Brain. One place to register every tool + helpers to
// look them up and convert them into the OpenRouter (OpenAI-compatible) tools
// param the model sees.
import 'server-only';
import { z } from 'zod';
import type { BrainTool } from './types';
import { getTicketTool, listTicketsTool, updateTicketTool } from './tickets';
import { broadcastStatusTool } from './broadcast';
import { getDeployStatusTool } from './deploy';

// The P0 tool set. Order is not significant.
export const ALL_TOOLS: BrainTool[] = [
  getTicketTool,
  listTicketsTool,
  updateTicketTool,
  broadcastStatusTool,
  getDeployStatusTool,
];

const BY_NAME = new Map<string, BrainTool>(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): BrainTool | undefined {
  return BY_NAME.get(name);
}

// Resolve a persona's allowed tools (falls back to all when the list is '*').
export function toolsFor(allowed: string[] | '*'): BrainTool[] {
  if (allowed === '*') return ALL_TOOLS;
  return allowed.map((n) => BY_NAME.get(n)).filter((t): t is BrainTool => Boolean(t));
}

// An OpenAI/OpenRouter "tools" array entry for one tool.
export type OpenAiTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export function toOpenAiTools(tools: BrainTool[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      // zod → JSON schema for the model. `target: openapi-3.0` drops the
      // $schema key and keeps to the subset function-calling accepts.
      parameters: z.toJSONSchema(t.schema, { target: 'openapi-3.0' }) as Record<string, unknown>,
    },
  }));
}

export type { BrainTool, ToolContext, ToolResult, ToolAutonomy } from './types';
