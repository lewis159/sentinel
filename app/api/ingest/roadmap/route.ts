// Roadmap upsert ingest — lets agents/CI write roadmap items programmatically
// (no DB access / no manual SQL). Mirrors /api/ingest/update: NOT Clerk-gated
// (it's in the middleware PUBLIC matcher). PRIVILEGED ingest route: authenticated
// with OPS_INGEST_SECRET ONLY (the browser report token is NOT accepted here).
//
//   1. HMAC  — header `x-ingest-signature` = HMAC-SHA256(rawBody, secret).
//   2. Token — header `x-ingest-token` = the secret (or `Authorization: Bearer`).
//
//   OPS_INGEST_SECRET unset       → 503 { error: 'ingest not configured' }
//   neither HMAC nor token valid  → 401
//
//   POST /api/ingest/roadmap
//   body: a single item OR { items: [ ...item ] }
//   item: { item_key (required), title?, description?,
//           status? (backlog|in_progress|in_review|shipped, default backlog),
//           app? (default 'Estate'), sort_order? (int, default 0) }
//   → 200 { ok: true, upserted: <n> }   (upsert ON CONFLICT (item_key))

import { upsertRoadmapItems, type RoadmapUpsertInput } from '@/lib/data';
import { hasDb } from '@/lib/db';
import { verifyPrivilegedIngest } from '@/lib/ingest-auth';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ingest-token, x-ingest-signature, Authorization',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: Request) {
  // Read the RAW body first so an HMAC (if used) is computed over the exact bytes.
  const raw = await req.text();

  // --- Auth: PRIVILEGED tier (OPS_INGEST_SECRET only), token OR HMAC ---
  const authed = verifyPrivilegedIngest(req, raw);
  if (!authed.ok) {
    return json({ error: authed.error }, authed.status);
  }

  if (!hasDb) {
    return json({ error: 'database not configured' }, 503);
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  // Accept a single item or { items: [...] }.
  const rawItems: any[] = Array.isArray(body?.items)
    ? body.items
    : body && typeof body === 'object'
      ? [body]
      : [];

  const items: RoadmapUpsertInput[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const key = typeof it.item_key === 'string' ? it.item_key.trim() : '';
    if (!key) {
      return json({ error: 'each item requires a non-empty item_key' }, 400);
    }
    items.push({
      item_key: key,
      title: it.title,
      description: it.description,
      status: it.status,
      app: it.app,
      sort_order: it.sort_order,
    });
  }

  if (items.length === 0) {
    return json({ error: 'no roadmap items provided' }, 400);
  }

  try {
    const upserted = await upsertRoadmapItems(items);
    return json({ ok: true, upserted }, 200);
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'ingest failed' }, 500);
  }
}
