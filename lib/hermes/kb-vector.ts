// Server-only pgvector retrieval for the Hermes KB. Embeds the query and returns
// the top-k most similar chunks from hermes.kb_chunks by cosine distance, mapped
// to the SAME KbSnippet shape the lexical retriever returns so every agent caller
// is unaffected. Never throws: on any failure (no DB, no key, embed error, empty
// store) it returns null so retrieveKb() can fall back to lexical snippets.

import 'server-only';
import { hasDb, q } from '@/lib/db';
import { embed, toVectorLiteral } from './embeddings';
import type { KbSnippet } from './kb-context';

/**
 * Semantic top-k over hermes.kb_chunks. Returns KbSnippet[] on success (possibly
 * empty if the store has no rows), or null when retrieval is unavailable so the
 * caller falls back to lexical. `<=>` is pgvector's cosine distance (smaller =
 * closer); the HNSW index (13_hermes_kb.sql) serves the ORDER BY … LIMIT.
 */
export async function retrieveKbVector(query: string, limit = 3): Promise<KbSnippet[] | null> {
  if (!hasDb) return null;
  const text = query.trim();
  if (!text) return [];

  const res = await embed([text]);
  if (!res.ok || res.vectors.length === 0) return null;

  try {
    const rows = await q<{ source: string; source_ref: string; title: string; chunk_text: string }>(
      `select source, source_ref, title, chunk_text
         from hermes.kb_chunks
        where embedding is not null
        order by embedding <=> $1::vector
        limit $2`,
      [toVectorLiteral(res.vectors[0]), Math.max(0, limit)],
    );

    return rows.map((r) => ({
      // 'kb' rows carry the article slug (resolves to /v2/kb/<slug>); 'ticket'
      // rows carry the ticket ref as the citation slug.
      slug: r.source_ref,
      title: r.title || r.source_ref,
      body: r.chunk_text,
    }));
  } catch {
    // Table missing (migration not applied) / pgvector absent → lexical fallback.
    return null;
  }
}
