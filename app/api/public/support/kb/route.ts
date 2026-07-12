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
import { getSupportStatus } from '@/lib/support-status';
import {
  clientIp, corsHeaders, readCappedText, isJsonContentType,
  kbBodySchema, CAPS, RATE,
} from '@/lib/intake-guards';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const METHODS = 'GET, POST, OPTIONS';

function json(req: Request, body: unknown, status = 200, extra?: Record<string, string>) {
  return Response.json(body, { status, headers: { ...corsHeaders(req, METHODS), ...extra } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req, METHODS) });
}

// Per-IP rate limit shared by GET and POST. Returns a 429 Response when tripped.
function rateLimited(req: Request): Response | null {
  const rl = checkRateLimit(`kb:${clientIp(req)}`, { limit: RATE.kbPerMin, windowMs: RATE.windowMs });
  if (rl.ok) return null;
  return json(req, { error: 'rate limit exceeded' }, 429, { 'Retry-After': String(rl.retryAfterSec) });
}

// Public base for KB deep-links back into the live v2 KB (article slugs resolve
// at /v2/kb/<slug>). Override per-estate with SUPPORT_KB_PUBLIC_BASE.
const KB_BASE = (process.env.SUPPORT_KB_PUBLIC_BASE ?? '').replace(/\/$/, '');

// Coarse service status surfaced alongside deflection results. Resolved from the
// estate monitoring via lib/support-status (Alertmanager → Uptime-Kuma → default),
// cached and non-throwing, so it degrades to 'operational' rather than failing the
// search. Shared with GET /api/public/support/status.
async function coarseStatus(): Promise<string> {
  try {
    return (await getSupportStatus()).status;
  } catch {
    return 'operational';
  }
}

async function handle(req: Request, query: string, limit: number) {
  try {
    const [results, status] = await Promise.all([
      retrieveKb(query, limit).then((rows) =>
        rows.map((a) => ({
          slug: a.slug,
          title: a.title,
          body: a.body,
          url: KB_BASE ? `${KB_BASE}/v2/kb/${a.slug}` : `/v2/kb/${a.slug}`,
        })),
      ),
      coarseStatus(),
    ]);
    return json(req, { results, status });
  } catch (e: any) {
    console.error('[support/kb] search failed:', e?.message ?? e);
    return json(req, { error: 'kb search failed' }, 500);
  }
}

export async function GET(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;
  // GET has no body to HMAC-sign; the widget presents the token header.
  const authed = verifySupportIntake(req, '');
  if (!authed.ok) return json(req, { error: authed.error }, authed.status);
  if (!intakeEnabled()) return json(req, { error: 'support intake disabled' }, 503);

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, CAPS.query);
  if (!q) return json(req, { results: [], status: await coarseStatus() });
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 3, 1), 8);
  return handle(req, q, limit);
}

export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;
  if (!isJsonContentType(req)) return json(req, { error: 'content-type must be application/json' }, 415);
  const { raw, tooLarge } = await readCappedText(req, CAPS.kbBodyBytes);
  if (tooLarge) return json(req, { error: 'payload too large' }, 413);

  const authed = verifySupportIntake(req, raw);
  if (!authed.ok) return json(req, { error: authed.error }, authed.status);
  if (!intakeEnabled()) return json(req, { error: 'support intake disabled' }, 503);

  let parsedJson: unknown;
  try { parsedJson = raw ? JSON.parse(raw) : {}; } catch { return json(req, { error: 'invalid JSON body' }, 400); }
  const parsed = kbBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(req, { error: 'invalid request' }, 400);

  const q = (parsed.data.q ?? '').trim();
  if (!q) return json(req, { results: [], status: await coarseStatus() });
  const limit = Math.min(Math.max(parsed.data.limit ?? 3, 1), 8);
  return handle(req, q, limit);
}
