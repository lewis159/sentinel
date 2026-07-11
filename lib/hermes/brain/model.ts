// LangGraph-compatible chat model backed by the EXISTING OpenRouter config.
//
// The Brain's reasoning node calls callModel() to get either a final answer or a
// batch of tool calls. It reuses lib/hermes/config.ts (Infisical → env → DB) for
// the API key + default model — the SAME resolution the copilot agents use — so
// there's one place to configure the provider. A per-persona model override is
// allowed; default = the configured global model.
//
// We hit OpenRouter's OpenAI-compatible /chat/completions with a `tools` array
// (function-calling) rather than depending on @langchain/openai, so the whole
// call path (key handling, headers, base URL) stays in our control and never
// logs the key.
import 'server-only';
import { getHermesRuntimeConfig } from '@/lib/hermes/config';
import type { OpenAiTool } from './tools';

// The message shapes we exchange with OpenRouter (OpenAI wire format), including
// the tool-calling roles the simple lib/hermes/openrouter.ts wrapper doesn't cover.
export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ChatMsg =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type WireToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ModelResult =
  | { ok: true; content: string; toolCalls: ToolCall[]; model: string }
  | { ok: false; error: string; model?: string };

function parseToolCalls(raw: any): ToolCall[] {
  const calls: WireToolCall[] | undefined = raw?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(calls)) return [];
  const out: ToolCall[] = [];
  for (const c of calls) {
    if (!c?.function?.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
    } catch {
      args = {};
    }
    out.push({ id: c.id ?? `call_${out.length}`, name: c.function.name, args });
  }
  return out;
}

export async function callModel(opts: {
  messages: ChatMsg[];
  tools?: OpenAiTool[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<ModelResult> {
  const cfg = await getHermesRuntimeConfig();
  if (!cfg.apiKey) return { ok: false, error: 'OPENROUTER_API_KEY not set' };
  const model = opts.model ?? cfg.model;

  try {
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1200,
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ops.scribuo.com',
        'X-Title': 'Sentinel Hermes Brain',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `OpenRouter ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`, model };
    }

    const json: any = await res.json();
    const content: string = json?.choices?.[0]?.message?.content ?? '';
    const toolCalls = parseToolCalls(json);
    return { ok: true, content, toolCalls, model: json?.model ?? model };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'OpenRouter request failed', model };
  }
}
