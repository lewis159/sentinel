// Report-issue ingest — the "data INTO Sentinel" path for estate apps.
//
// Estate apps (YT, Springsteen, …) have NO Clerk session against Sentinel, so
// this route is NOT Clerk-gated (it's in the middleware PUBLIC matcher). It is
// authenticated with OPS_INGEST_SECRET, mirroring /api/ops/ingest. Two modes:
//
//   1. HMAC  — header `x-ingest-signature` = HMAC-SHA256(rawBody, secret).
//              Use for server-to-server callers that can sign without leaking
//              the secret to a browser.
//   2. Token — header `x-ingest-token` = the secret (or `Authorization: Bearer`).
//              Use for the embeddable browser widget, where the token is a
//              per-deployment shared secret baked into the estate app.
//
//   OPS_INGEST_SECRET unset           → 503 { error: 'ingest not configured' }
//   neither HMAC nor token valid      → 401
//
//   POST /api/ingest/issue
//   body: { app, title, description?, type?, severity?, url?, reporter? }
//     type: bug|incident|request|change|problem|release|feedback (→ ticket kind)
//   → 201 { ok: true, ref }
//
// Inserts into ops.tickets via createTicket: status=new (the report inbox
// state), source='report-issue', app from payload, url+reporter captured in
// attrs. The generated ref (INC-/REQ-/…-####) doubles as the error code shown
// back to the reporter.

import crypto from 'crypto';
import { createTicket } from '@/lib/data';
import type { TicketKind, Severity } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// CORS: estate apps POST from their own origins. The token/HMAC is the real
// access control; CORS is just to let the browser fetch succeed.
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

// Map the widget's "type" to an ITIL ticket kind.
function typeToKind(type?: string): TicketKind {
  switch ((type ?? '').toLowerCase()) {
    case 'incident': return 'incident';
    case 'request': return 'request';
    case 'change': return 'change';
    case 'problem': return 'problem';
    case 'release': return 'release';
    // 'bug' / 'feedback' / anything unknown → an incident in the report inbox.
    default: return 'incident';
  }
}

function sevToImpactUrgency(severity?: string): { impact: string; urgency: string; priority: Severity } {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical': return { impact: 'high', urgency: 'high', priority: 'critical' };
    case 'high': return { impact: 'high', urgency: 'medium', priority: 'high' };
    case 'low': return { impact: 'low', urgency: 'low', priority: 'low' };
    default: return { impact: 'medium', urgency: 'medium', priority: 'medium' };
  }
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

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return json({ error: 'title is required' }, 400);
  }

  const kind = typeToKind(body?.type);
  const { impact, urgency, priority } = sevToImpactUrgency(body?.severity);

  try {
    const { ref } = await createTicket({
      kind,
      title,
      description: typeof body?.description === 'string' ? body.description : undefined,
      app: typeof body?.app === 'string' ? body.app : 'Estate',
      impact,
      urgency,
      priority,
      status: 'new', // report inbox — triaged into the kind's workflow by an operator
      source: 'report-issue',
      attrs: {
        url: typeof body?.url === 'string' ? body.url : undefined,
        reporter: typeof body?.reporter === 'string' ? body.reporter : undefined,
        report_type: typeof body?.type === 'string' ? body.type : undefined,
        severity: typeof body?.severity === 'string' ? body.severity : undefined,
      },
    });
    return json({ ok: true, ref }, 201);
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'ingest failed' }, 500);
  }
}
