// Server-only embeddings client for the Hermes KB (pgvector). Thin wrapper over
// the OpenAI-compatible `/embeddings` endpoint. Never throws — every failure
// path (missing key, network, non-2xx, unexpected shape, dimension mismatch)
// resolves to { ok:false, error } exactly like openrouter.ts. The API key is
// resolved via the existing runtime config layer (Infisical → env → DB) and is
// NEVER logged.
//
// PROVIDER NOTE: the KB reuses the OpenRouter key by default (base
// https://openrouter.ai/api/v1/embeddings). OpenRouter's embeddings coverage is
// narrower than its chat coverage, so both the endpoint and the API key can be
// overridden to point straight at OpenAI (or any OpenAI-compatible embeddings
// server) without touching the chat config:
//   HERMES_EMBEDDINGS_URL      default https://openrouter.ai/api/v1/embeddings
//   HERMES_EMBEDDINGS_MODEL    default text-embedding-3-small (1536 dims)
//   HERMES_EMBEDDINGS_API_KEY  default = the resolved OpenRouter key
// The embedding DIMENSION must match db/init/13_hermes_kb.sql's vector(N).

import 'server-only';
import { getHermesRuntimeConfig } from './config';

// Default model + its native dimension. If you change the model to one with a
// different dimension, also change vector(N) in db/init/13_hermes_kb.sql.
export const DEFAULT_EMBEDDINGS_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;

const DEFAULT_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';

// Max inputs per request — keep batches modest so a single large reindex doesn't
// exceed provider per-request limits.
const BATCH_SIZE = 96;

export function embeddingsModel(): string {
  const m = (process.env.HERMES_EMBEDDINGS_MODEL ?? '').trim();
  return m || DEFAULT_EMBEDDINGS_MODEL;
}

type EmbedResult =
  | { ok: true; vectors: number[][]; model: string }
  | { ok: false; error: string };

async function resolveKey(): Promise<string | undefined> {
  const override = (process.env.HERMES_EMBEDDINGS_API_KEY ?? '').trim();
  if (override) return override;
  const cfg = await getHermesRuntimeConfig();
  return cfg.apiKey;
}

// Embed a single batch (≤ BATCH_SIZE inputs). Never throws.
async function embedBatch(
  inputs: string[],
  key: string,
  model: string,
  url: string,
): Promise<EmbedResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ops.scribuo.com',
        'X-Title': 'Sentinel Hermes KB',
      },
      body: JSON.stringify({ model, input: inputs }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `embeddings ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
      };
    }

    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    if (data.length !== inputs.length) {
      return { ok: false, error: 'embeddings returned wrong number of vectors' };
    }
    // Preserve request order (OpenAI returns an `index` per item).
    const vectors: number[][] = new Array(inputs.length);
    for (const item of data) {
      const idx = typeof item?.index === 'number' ? item.index : -1;
      const vec = item?.embedding;
      if (idx < 0 || idx >= inputs.length || !Array.isArray(vec)) {
        return { ok: false, error: 'embeddings returned an unexpected shape' };
      }
      if (vec.length !== EMBEDDING_DIMS) {
        return {
          ok: false,
          error: `embedding dimension ${vec.length} != expected ${EMBEDDING_DIMS} (model/column mismatch)`,
        };
      }
      vectors[idx] = vec as number[];
    }
    return { ok: true, vectors, model };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'embeddings request failed' };
  }
}

/**
 * Embed a list of texts. Batched, order-preserving, never throws. Returns
 * { ok:true, vectors } (vectors[i] aligns with texts[i]) or { ok:false, error }.
 * An empty input list is a successful no-op.
 */
export async function embed(texts: string[]): Promise<EmbedResult> {
  if (texts.length === 0) return { ok: true, vectors: [], model: embeddingsModel() };

  const key = await resolveKey();
  if (!key) return { ok: false, error: 'no embeddings API key (OPENROUTER_API_KEY / HERMES_EMBEDDINGS_API_KEY not set)' };

  const model = embeddingsModel();
  const url = (process.env.HERMES_EMBEDDINGS_URL ?? '').trim() || DEFAULT_EMBEDDINGS_URL;

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await embedBatch(batch, key, model, url);
    if (!res.ok) return res;
    out.push(...res.vectors);
  }
  return { ok: true, vectors: out, model };
}

/** Format a JS number[] as a pgvector literal string: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
