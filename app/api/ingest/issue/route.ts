// Report-issue ingest — the "data INTO Sentinel" path for estate apps.
//
// Estate apps (YT, Springsteen, …) have NO Clerk session against Sentinel, so
// this route is NOT Clerk-gated (it's in the middleware PUBLIC matcher). This is
// the ONLY ingest route at the least-privilege REPORT tier: it accepts EITHER
//   • OPS_REPORT_TOKEN  — the dedicated, least-privilege token that ships in the
//     browser report-issue widget (creating a report ticket is all it grants), OR
//   • OPS_INGEST_SECRET — the privileged estate secret (server/CI only).
// in EITHER of two modes:
//
//   1. HMAC  — header `x-ingest-signature` = HMAC-SHA256(rawBody, secret).
//              Use for server-to-server callers that can sign without leaking
//              the secret to a browser.
//   2. Token — header `x-ingest-token` = the secret (or `Authorization: Bearer`).
//              Use for the embeddable browser widget (use OPS_REPORT_TOKEN here).
//
//   neither OPS_REPORT_TOKEN nor OPS_INGEST_SECRET set → 503 { error: 'ingest not configured' }
//   neither HMAC nor token valid                       → 401
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

import { createTicket } from '@/lib/data';
import { verifyReportIngest } from '@/lib/ingest-auth';
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

export async function POST(req: Request) {
  // Read the RAW body first so an HMAC (if used) is computed over the exact bytes.
  const raw = await req.text();

  // --- Auth: REPORT tier (OPS_REPORT_TOKEN or OPS_INGEST_SECRET), token OR HMAC ---
  const authed = verifyReportIngest(req, raw);
  if (!authed.ok) {
    return json({ error: authed.error }, authed.status);
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
