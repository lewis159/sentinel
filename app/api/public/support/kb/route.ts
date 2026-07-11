// Customer support L0 SELF-SERVE search — the "answer before a conversation"
// path. The public support-chat widget hits this FIRST: the customer types a
// question, we return the most relevant knowledge-base snippets (so many are
// deflected without ever opening a ticket) plus a coarse service status.
//
// NOT Clerk-gated (public matcher); authenticates in-route with the least-
// privilege OPS_SUPPORT_TOKEN (same token the widget already holds). Behind
// HERMES_INTAKE_ENABLED. Read-only — it creates nothing.
//
//   GET  /api/public/support/kb?q=<question>&limit=<n>
//   POST /api/public/support/kb   body: { q, limit? }
//   → 200 { results: [{ slug, title, body, url }], status }

import { verifySupportIntake } from '@/lib/ingest-auth';
import { intakeEnabled } from '@/lib/hermes/brain/flags';
import { retrieveKb } from '@/lib/hermes/kb-context';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ingest-token, x-ingest-signature, Authorization',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Public base for KB deep-links back into the live v2 KB (article slugs resolve
// at /v2/kb/<slug>). Override per-estate with SUPPORT_KB_PUBLIC_BASE.
const KB_BASE = (process.env.SUPPORT_KB_PUBLIC_BASE ?? '').replace(/\/$/, '');

async function handle(req: Request, query: string, limit: number) {
  const results = (await retrieveKb(query, limit)).map((a) => ({
    slug: a.slug,
    title: a.title,
    body: a.body,
    url: KB_BASE ? `${KB_BASE}/v2/kb/${a.slug}` : `/v2/kb/${a.slug}`,
  }));
  // Coarse status surfaced alongside deflection results. There is no live status
  // source wired to this public surface yet, so we report a static 'operational';
  // when a status source lands, resolve it here without changing the contract.
  return json({ results, status: 'operational' });
}

export async function GET(req: Request) {
  // GET has no body to HMAC-sign; the widget presents the token header.
  const authed = verifySupportIntake(req, '');
  if (!authed.ok) return json({ error: authed.error }, authed.status);
  if (!intakeEnabled()) return json({ error: 'support intake disabled' }, 503);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return json({ results: [], status: 'operational' });
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 3, 1), 8);
  return handle(req, q, limit);
}

export async function POST(req: Request) {
  const raw = await req.text();
  const authed = verifySupportIntake(req, raw);
  if (!authed.ok) return json({ error: authed.error }, authed.status);
  if (!intakeEnabled()) return json({ error: 'support intake disabled' }, 503);

  let body: any;
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'invalid JSON body' }, 400); }
  const q = (typeof body?.q === 'string' ? body.q : '').trim();
  if (!q) return json({ results: [], status: 'operational' });
  const limit = Math.min(Math.max(Number(body?.limit) || 3, 1), 8);
  return handle(req, q, limit);
}
