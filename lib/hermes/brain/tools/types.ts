// Tool registry contract for the Brain. Each tool is a small, self-describing
// unit: a name + description (fed to the model), a zod schema (validated at call
// time AND converted to JSON schema for the OpenRouter tools param), an autonomy
// level, and a run() implementation.
//
//   autonomy: 'auto'  → the graph executes the tool immediately (read / safe).
//   autonomy: 'gated' → the graph INTERRUPTS before running it; a human must
//                       approve it in the Sentinel Approvals queue, and only then
//                       does the resume path actually run() it.
import type { z } from 'zod';

export type ToolAutonomy = 'auto' | 'gated';

// Context passed to every tool run — who/what triggered it, for audit + routing.
export type ToolContext = {
  threadId: string;      // conversation thread, e.g. 'discord:123' | 'web:abc'
  persona: string;       // persona id that invoked the tool (e.g. 'pa')
  actor: string;         // audit label: 'discord:<user>' | clerk user | 'pa'
};

export type ToolResult = {
  ok: boolean;
  // Human/model-readable summary of what happened (fed back as the observation).
  summary: string;
  // Structured payload (optional) — surfaced in audit + the resumed observation.
  data?: unknown;
  error?: string;
};

export type BrainTool<A = any> = {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  autonomy: ToolAutonomy;
  // A one-line human summary of a proposed call, shown in the Approvals queue.
  describeCall?: (args: A) => string;
  run: (args: A, ctx: ToolContext) => Promise<ToolResult>;
};
