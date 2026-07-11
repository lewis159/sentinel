// Bot KB reindex — rebuild the Hermes semantic KB (hermes.kb_chunks) from the
// markdown articles + resolved tickets. Token-gated (BOT tier, same auth as the
// other /api/bot/* routes) so an EXTERNAL cron can drive it, e.g.:
//
//   */30 * * * *  curl -fsS -X POST -H "x-ingest-token: $OPS_BOT_TOKEN" \
//     https://ops.scribuo.com/api/bot/kb/reindex
//
// Idempotent + safe to re-run: unchanged chunks (content_hash hit) are skipped
// and never re-embedded; stale chunks are pruned. Behind HERMES_KB_PGVECTOR —
// returns { status:'disabled' } when off, so the flag alone controls whether the
// vector KB is populated and used (retrieval falls back to lexical otherwise).
//
//   POST /api/bot/kb/reindex → 200 { ok, embedded, skipped, pruned, sources, ... }

import { reindexKb } from '@/lib/hermes/kb-index';
import { kbPgvectorEnabled } from '@/lib/hermes/brain/flags';
import { authBot, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return botOptions();
}

export async function POST(req: Request) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  if (!kbPgvectorEnabled()) {
    return botJson({
      status: 'disabled',
      error: 'Semantic KB is disabled — set HERMES_KB_PGVECTOR=1 to enable.',
    });
  }

  try {
    const stats = await reindexKb();
    return botJson(stats, stats.ok ? 200 : 200);
  } catch (e: any) {
    return botJson({ ok: false, error: e?.message ?? 'kb reindex failed' }, 200);
  }
}
