// Changelog append ingest — lets agents/CI append changelog entries
// programmatically (no DB access / no manual SQL). Mirrors /api/ingest/update:
// NOT Clerk-gated (it's in the middleware PUBLIC matcher). PRIVILEGED ingest
// route: authenticated with OPS_INGEST_SECRET ONLY (the browser report token is
// NOT accepted here).
//
//   1. HMAC  — header `x-ingest-signature` = HMAC-SHA256(rawBody, secret).
//   2. Token — header `x-ingest-token` = the secret (or `Authorization: Bearer`).
//
//   OPS_INGEST_SECRET unset       → 503 { error: 'ingest not configured' }
//   neither HMAC nor token valid  → 401
//
//   POST /api/ingest/changelog
//   body: a single entry OR { entries: [ ...entry ] }
//   entry: { label (required), version?, date? (ISO, default now()),
//            body?, app? (default 'Estate') }
//   → 200 { ok: true, inserted: <n>, skipped: <m> }
//   Re-runnable: an entry whose (version, label) already exists is skipped
//   (no unique constraint, so we check-then-insert rather than ON CONFLICT).

import { addChangelogEntries, type ChangelogInput } from '@/lib/data';
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

  // Accept a single entry or { entries: [...] }.
  const rawEntries: any[] = Array.isArray(body?.entries)
    ? body.entries
    : body && typeof body === 'object'
      ? [body]
      : [];

  const entries: ChangelogInput[] = [];
  for (const e of rawEntries) {
    if (!e || typeof e !== 'object') continue;
    const label = typeof e.label === 'string' ? e.label.trim() : '';
    if (!label) {
      return json({ error: 'each entry requires a non-empty label' }, 400);
    }
    entries.push({
      label,
      version: e.version,
      date: e.date,
      body: e.body,
      app: e.app,
    });
  }

  if (entries.length === 0) {
    return json({ error: 'no changelog entries provided' }, 400);
  }

  try {
    const { inserted, skipped } = await addChangelogEntries(entries);
    return json({ ok: true, inserted, skipped }, 200);
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'ingest failed' }, 500);
  }
}
