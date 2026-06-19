// Agent/system update ingest — the "append an update to a ticket" path for
// programmatic callers (e.g. Claude posting progress as work proceeds).
//
// Like /api/ingest/issue this route is NOT Clerk-gated (it's in the middleware
// PUBLIC matcher). It is authenticated with OPS_INGEST_SECRET. Two modes:
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

import crypto from 'crypto';
import { addTicketComment } from '@/lib/data';

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

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function hmacMatches(secret: string, raw: string, provided: string): boolean {
  if (!provided) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.OPS_INGEST_SECRET;
  if (!secret) {
    return json({ error: 'ingest not configured' }, 503);
  }

  // Read the RAW body first so an HMAC (if used) is computed over the exact bytes.
  const raw = await req.text();

  // --- Auth: token OR HMAC ---
  const token =
    req.headers.get('x-ingest-token') ??
    (req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
  const sig = req.headers.get('x-ingest-signature') ?? '';
  const ok =
    (token && timingSafeEqualStr(token, secret)) ||
    hmacMatches(secret, raw, sig);
  if (!ok) {
    return json({ error: 'invalid credentials' }, 401);
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
