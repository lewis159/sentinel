// Public LEAD intake — the "inbound enquiry lands" path for Sales / Lead
// qualification. Mirrors the hardened public support-chat intake pattern exactly:
// NOT Clerk-gated (a prospect has no Clerk session against Sentinel), lives in the
// middleware PUBLIC matcher, and authenticates IN-ROUTE with the least-privilege
// support token (OPS_SUPPORT_TOKEN, or the privileged OPS_INGEST_SECRET for
// server-side callers) via token OR HMAC.
//
// Behind HERMES_LEADS_ENABLED — OFF by default, so this surface is inert until
// explicitly enabled (the shipped app is unaffected).
//
//   POST /api/public/leads
//   body: { name?, email?, company?, message, source? }
//   → 200 { ok, ref, tier, score }
//
// The lead is scored DETERMINISTICALLY inline (no model call on the public path)
// and stored as a request ticket tagged attrs.lead=true (lib/leads/store). Any
// reply / outbound is DRAFT-ONLY and happens later from the gated admin surface.

import { createLead } from '@/lib/leads/store';
import { verifySupportIntake } from '@/lib/ingest-auth';
import { leadsEnabled } from '@/lib/hermes/brain/flags';
import {
  clientIp, corsHeaders, readCappedText, isJsonContentType, CAPS, RATE,
} from '@/lib/intake-guards';
import { checkRateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const METHODS = 'POST, OPTIONS';

function json(req: Request, body: unknown, status = 200, extra?: Record<string, string>) {
  return Response.json(body, { status, headers: { ...corsHeaders(req, METHODS), ...extra } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req, METHODS) });
}

// Reuse the same field caps the support intake uses; a lead adds `company` and
// `source` (both bounded, optional) and requires a non-empty `message`.
const leadBodySchema = z.object({
  message: z.string().trim().min(1).max(CAPS.message),
  name: z.string().trim().max(CAPS.name).optional(),
  email: z.string().trim().max(CAPS.email).email().optional().or(z.literal('')),
  company: z.string().trim().max(CAPS.name).optional(),
  source: z.string().trim().max(CAPS.app).optional(),
}).strip();

export async function POST(req: Request) {
  // 1. Content-type + size cap BEFORE any auth / DB work.
  if (!isJsonContentType(req)) return json(req, { error: 'content-type must be application/json' }, 415);
  const { raw, tooLarge } = await readCappedText(req, CAPS.chatBodyBytes);
  if (tooLarge) return json(req, { error: 'payload too large' }, 413);

  // 2. Per-IP sliding-window rate limit (ticket-spam control), before auth so an
  // invalid-token flood is throttled too. Reuses the chat RPM budget.
  const rl = checkRateLimit(`leads:${clientIp(req)}`, { limit: RATE.chatPerMin, windowMs: RATE.windowMs });
  if (!rl.ok) {
    return json(req, { error: 'rate limit exceeded' }, 429, { 'Retry-After': String(rl.retryAfterSec) });
  }

  // 3. Auth (token/HMAC over the exact raw bytes) + feature flag.
  const authed = verifySupportIntake(req, raw);
  if (!authed.ok) return json(req, { error: authed.error }, authed.status);

  if (!leadsEnabled()) {
    return json(req, { error: 'lead intake disabled' }, 503);
  }

  // 4. Parse + strictly validate/bound every field.
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(raw); } catch { return json(req, { error: 'invalid JSON body' }, 400); }
  const parsed = leadBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(req, { error: 'invalid request' }, 400);
  const body = parsed.data;

  try {
    const { ref, assessment } = await createLead({
      name: body.name ?? null,
      email: body.email ? body.email : null,
      company: body.company ?? null,
      message: body.message,
      source: body.source ?? 'web',
    });
    return json(req, { ok: true, ref, tier: assessment.tier, score: assessment.score });
  } catch (e: any) {
    // Never leak internal detail to the public caller.
    console.error('[public/leads] intake failed:', e?.message ?? e);
    return json(req, { ok: false, error: 'lead intake failed' }, 500);
  }
}
