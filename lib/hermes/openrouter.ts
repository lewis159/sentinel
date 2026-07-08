// Server-only OpenRouter chat client. Thin wrapper over the OpenAI-compatible
// /chat/completions endpoint. Never throws — every failure path (missing key,
// network, non-2xx, unexpected shape) resolves to { ok:false, error }. The API
// key + model are resolved via the runtime config layer (DB-backed, env
// fallback) and the key is NEVER logged.

import 'server-only';
import { getHermesRuntimeConfig } from './config';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function chat(opts: {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ ok: boolean; content?: string; error?: string; model?: string }> {
  const cfg = await getHermesRuntimeConfig();
  const key = cfg.apiKey;
  if (!key) return { ok: false, error: 'OPENROUTER_API_KEY not set' };

  const model = opts.model ?? cfg.model;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ops.scribuo.com',
        'X-Title': 'Sentinel Hermes',
      },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1200,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `OpenRouter ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
        model,
      };
    }

    const json: any = await res.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { ok: false, error: 'OpenRouter returned no message content', model };
    }
    return { ok: true, content, model: json?.model ?? model };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'OpenRouter request failed', model };
  }
}
