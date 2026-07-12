// Public SERVICE STATUS for the support-chat widget — the coarse
// operational/degraded/down dot shown in the widget header.
//
// Same public surface contract as /api/public/support/kb: NOT Clerk-gated
// (public matcher); authenticates in-route with the least-privilege
// OPS_SUPPORT_TOKEN the widget already holds; behind HERMES_INTAKE_ENABLED;
// origin-scoped CORS; per-IP rate limited. Read-only — it creates nothing and
// only reads the estate monitoring (via lib/support-status, which reuses the
// existing Alertmanager + Uptime-Kuma clients and can never throw).
//
//   GET /api/public/support/status
//   → 200 { status: 'operational'|'degraded'|'down', source, components, note? }
//
// It NEVER 500s on a monitoring failure: getSupportStatus() falls back to
// 'operational' (source:'default') so the widget dot is always safe.

import { verifySupportIntake } from '@/lib/ingest-auth';
import { intakeEnabled } from '@/lib/hermes/brain/flags';
import { getSupportStatus } from '@/lib/support-status';
import { clientIp, corsHeaders, RATE } from '@/lib/intake-guards';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const METHODS = 'GET, OPTIONS';

function json(req: Request, body: unknown, status = 200, extra?: Record<string, string>) {
  return Response.json(body, { status, headers: { ...corsHeaders(req, METHODS), ...extra } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req, METHODS) });
}

export async function GET(req: Request) {
  // Share the KB per-IP budget — this is a cheap, cached read.
  const rl = checkRateLimit(`status:${clientIp(req)}`, { limit: RATE.kbPerMin, windowMs: RATE.windowMs });
  if (!rl.ok) return json(req, { error: 'rate limit exceeded' }, 429, { 'Retry-After': String(rl.retryAfterSec) });

  // GET has no body to HMAC-sign; the widget presents the token header.
  const authed = verifySupportIntake(req, '');
  if (!authed.ok) return json(req, { error: authed.error }, authed.status);
  if (!intakeEnabled()) return json(req, { error: 'support intake disabled' }, 503);

  // getSupportStatus() never throws by contract (both monitoring clients catch
  // internally), but we belt-and-suspenders it here: a status read must NEVER
  // 500 the public widget — worst case we report a safe operational/default.
  try {
    const { status, source, components, note } = await getSupportStatus();
    return json(req, { status, source, components, ...(note ? { note } : {}) });
  } catch (e: any) {
    console.error('[support/status] resolve failed:', e?.message ?? e);
    return json(req, { status: 'operational', source: 'default', components: [] });
  }
}
