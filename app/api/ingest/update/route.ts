// Agent/system update ingest — the "append an update to a ticket" path for
// programmatic callers (e.g. Claude posting progress as work proceeds).
//
// This route is NOT Clerk-gated (it's in the middleware PUBLIC matcher). It is a
// PRIVILEGED ingest route: authenticated with OPS_INGEST_SECRET ONLY (the
// browser report token OPS_REPORT_TOKEN is NOT accepted here). Two modes:
//
//   1. HMAC  — header `x-ingest-signature` = HMAC-SHA256(rawBody, secret).
//   2. Token — header `x-ingest-token` = the secret (or `Authorization: Bearer`).
//
//   OPS_INGEST_SECRET unset       → 503 { error: 'ingest not configured' }
//   neither HMAC nor token valid  → 401
//
//   POST /api/ingest/update
//   body: { ref, body, author? }
//   → 201 { ok: true, comment }   (kind='update', author = author||'Claude')

import { addTicketComment } from '@/lib/data';
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

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const ref = typeof body?.ref === 'string' ? body.ref.trim() : '';
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!ref) return json({ error: 'ref is required' }, 400);
  if (!text) return json({ error: 'body is required' }, 400);

  const author = typeof body?.author === 'string' && body.author.trim() ? body.author.trim() : 'Claude';

  try {
    const comment = await addTicketComment(ref, text, author, 'update');
    if (!comment) return json({ ok: false, error: `ticket ${ref} not found` }, 404);
    return json({ ok: true, comment }, 201);
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'ingest failed' }, 500);
  }
}
