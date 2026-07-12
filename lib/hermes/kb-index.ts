// Server-only Hermes KB indexer. Chunks the two KB sources — the markdown
// articles (content/kb/*.md) and resolved/closed tickets (title + description +
// resolution comments) — embeds each chunk, and UPSERTS them into
// hermes.kb_chunks. Idempotent + safe to re-run (an external cron drives it via
// POST /api/bot/kb/reindex): unchanged chunks are detected by content_hash and
// skipped (never re-embedded), and chunks that no longer exist for a document
// are pruned.
//
// Fail-safe: every DB / embeddings failure resolves to a structured result — it
// never throws — so a bad reindex never takes the app down. Retrieval falls back
// to lexical snippets independently (lib/hermes/kb-context.ts).

import 'server-only';
import { createHash } from 'crypto';
import { hasDb, q } from '@/lib/db';
import { listDocs, getDocRaw } from '@/lib/kb';
import { embed, toVectorLiteral } from './embeddings';

// Ticket statuses that count as "resolved" across the ITIL kinds (see
// KIND_STATUSES in lib/mock.ts): incident/problem → resolved, request →
// fulfilled, change → implemented, plus terminal closed / known_error.
const RESOLVED_STATUSES = [
  'resolved',
  'closed',
  'fulfilled',
  'implemented',
  'known_error',
  'done',
];

// ─── Chunking ──────────────────────────────────────────────────────────────
// Paragraph-packing chunker: split on blank lines, then greedily pack paragraphs
// up to ~maxChars with a small overlap tail so a concept that straddles a
// boundary is still retrievable from both chunks. A single oversized paragraph
// is hard-split. Markdown is kept as-is (good enough signal for embeddings).
export function chunkText(
  text: string,
  opts: { maxChars?: number; overlap?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? 1200;
  const overlap = opts.overlap ?? 150;

  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // Hard-split any paragraph longer than maxChars.
  const paras: string[] = [];
  for (const p of clean.split(/\n{2,}/)) {
    const t = p.trim();
    if (!t) continue;
    if (t.length <= maxChars) {
      paras.push(t);
    } else {
      for (let i = 0; i < t.length; i += maxChars) paras.push(t.slice(i, i + maxChars));
    }
  }

  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > maxChars) {
      chunks.push(buf);
      // Carry an overlap tail from the end of the flushed chunk.
      const tail = overlap > 0 ? buf.slice(-overlap) : '';
      buf = tail ? `${tail}\n\n${p}` : p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export type IndexStats = {
  ok: boolean;
  error?: string;
  sources: number;   // documents processed
  embedded: number;  // chunks newly embedded + written
  skipped: number;   // chunks unchanged (content_hash hit)
  pruned: number;    // stale chunks removed
};

// Upsert one document's chunks idempotently:
//   1. read existing hashes for (source, source_ref)
//   2. embed ONLY the new chunks (skip unchanged)
//   3. insert new rows (ON CONFLICT DO NOTHING — the unique key is the hash)
//   4. prune rows whose hash is no longer produced by this document
async function indexDocument(
  source: 'kb' | 'ticket',
  sourceRef: string,
  title: string,
  chunks: string[],
): Promise<{ embedded: number; skipped: number; pruned: number; error?: string }> {
  const hashes = chunks.map(sha256);

  // De-dupe within the document (identical chunk text → single row).
  const byHash = new Map<string, string>();
  chunks.forEach((c, i) => { if (!byHash.has(hashes[i])) byHash.set(hashes[i], c); });
  const wantHashes = [...byHash.keys()];

  if (wantHashes.length === 0) {
    // Empty document → prune everything we had for it.
    const del = await q<{ id: string }>(
      `delete from hermes.kb_chunks where source = $1 and source_ref = $2 returning id`,
      [source, sourceRef],
    );
    return { embedded: 0, skipped: 0, pruned: del.length };
  }

  const existing = await q<{ content_hash: string }>(
    `select content_hash from hermes.kb_chunks where source = $1 and source_ref = $2`,
    [source, sourceRef],
  );
  const existingSet = new Set(existing.map((r) => r.content_hash));

  const newHashes = wantHashes.filter((h) => !existingSet.has(h));
  const skipped = wantHashes.length - newHashes.length;

  let embedded = 0;
  if (newHashes.length > 0) {
    const texts = newHashes.map((h) => byHash.get(h) as string);
    const res = await embed(texts);
    if (!res.ok) return { embedded: 0, skipped, pruned: 0, error: res.error };

    for (let i = 0; i < newHashes.length; i += 1) {
      await q(
        `insert into hermes.kb_chunks (source, source_ref, title, chunk_text, embedding, content_hash, updated_at)
         values ($1, $2, $3, $4, $5::vector, $6, now())
         on conflict (source, source_ref, content_hash)
           do update set title = excluded.title, chunk_text = excluded.chunk_text,
                         embedding = excluded.embedding, updated_at = now()`,
        [source, sourceRef, title, texts[i], toVectorLiteral(res.vectors[i]), newHashes[i]],
      );
      embedded += 1;
    }
  }

  // Prune stale chunks (article edited / ticket comment removed).
  const pruneRes = await q<{ id: string }>(
    `delete from hermes.kb_chunks
      where source = $1 and source_ref = $2 and content_hash <> all($3::text[])
      returning id`,
    [source, sourceRef, wantHashes],
  );

  return { embedded, skipped, pruned: pruneRes.length };
}

// Build the source text for a resolved ticket: title + description + every
// comment body (the resolution/work notes), joined newest-context-last.
type ResolvedTicket = { ref: string; title: string; description: string | null };

async function loadResolvedTicketText(t: ResolvedTicket): Promise<string> {
  let comments: { body: string | null }[] = [];
  try {
    const row = await q<{ id: string }>(`select id from ops.tickets where ref = $1`, [t.ref]);
    if (row[0]) {
      comments = await q<{ body: string | null }>(
        `select body from ops.comments where ticket_id = $1 order by created_at asc`,
        [row[0].id],
      );
    }
  } catch {
    comments = [];
  }
  const parts = [
    t.title,
    t.description ?? '',
    ...comments.map((c) => c.body ?? ''),
  ].filter((s) => s && s.trim());
  return parts.join('\n\n');
}

/**
 * Full reindex of both sources into hermes.kb_chunks. Idempotent + never throws.
 * Requires a DB; embeddings are attempted per-document (missing key surfaces as
 * an error on the first document that needs new embeddings). Documents with no
 * new chunks are processed with zero embedding cost.
 */
export async function reindexKb(): Promise<IndexStats> {
  const stats: IndexStats = { ok: true, sources: 0, embedded: 0, skipped: 0, pruned: 0 };
  if (!hasDb) return { ...stats, ok: false, error: 'no DB' };

  try {
    // 1) KB markdown articles.
    for (const doc of listDocs()) {
      const raw = getDocRaw(doc.slug);
      if (!raw) continue;
      const chunks = chunkText(raw.raw);
      const r = await indexDocument('kb', doc.slug, raw.title, chunks);
      stats.sources += 1;
      stats.embedded += r.embedded;
      stats.skipped += r.skipped;
      stats.pruned += r.pruned;
      if (r.error) return { ...stats, ok: false, error: r.error };
    }

    // 2) Resolved / closed tickets (title + description + resolution comments).
    let tickets: ResolvedTicket[] = [];
    try {
      tickets = await q<ResolvedTicket>(
        `select ref, title, description from ops.tickets
          where status = any($1)
          order by coalesce(updated_at, opened_at, created_at) desc`,
        [RESOLVED_STATUSES],
      );
    } catch {
      tickets = [];
    }

    for (const t of tickets) {
      const text = await loadResolvedTicketText(t);
      const chunks = chunkText(text);
      const r = await indexDocument('ticket', t.ref, t.title, chunks);
      stats.sources += 1;
      stats.embedded += r.embedded;
      stats.skipped += r.skipped;
      stats.pruned += r.pruned;
      if (r.error) return { ...stats, ok: false, error: r.error };
    }

    return stats;
  } catch (e: any) {
    return { ...stats, ok: false, error: e?.message ?? 'reindex failed' };
  }
}
