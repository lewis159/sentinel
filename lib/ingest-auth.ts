// Shared ingest authentication — two privilege levels, one well-factored verify.
//
// Sentinel has two ingest privilege tiers, both authenticated WITHOUT a Clerk
// session (estate apps / CI have no Clerk session against Sentinel). They are
// kept deliberately separate so the blast radius of each secret is obvious:
//
//   • REPORT tier  — accepts EITHER `OPS_REPORT_TOKEN` (least privilege) OR the
//     privileged `OPS_INGEST_SECRET`. Used ONLY by /api/ingest/issue, which
//     creates a report ticket and nothing else. `OPS_REPORT_TOKEN` is the token
//     that ships in the browser report-issue widget (`data-token`), so it must
//     grant the minimum: "create a report ticket".
//
//   • PRIVILEGED tier — accepts ONLY `OPS_INGEST_SECRET`. Used by every other
//     ingest route (/api/ingest/update, /roadmap, /changelog,
//     /api/ops/ingest/[source]). This secret is server/CI-only and must NEVER be
//     placed in a browser.
//
// Both tiers support two presentation modes for a given accepted secret:
//   1. Token — header `x-ingest-token` OR `Authorization: Bearer <token>`,
//      compared timing-safely against the secret value.
//   2. HMAC  — header `x-ingest-signature` = hex(HMAC-SHA256(rawBody, secret)),
//      compared timing-safely. Lets server-to-server callers sign without
//      exposing the secret.
//
// All comparisons are constant-time. A request is authorized if it matches ANY
// accepted secret via EITHER mode.

import crypto from 'crypto';

// Timing-safe compare of two arbitrary UTF-8 strings (e.g. token vs. secret).
function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Timing-safe compare of an expected HMAC (computed over the raw body with
// `secret`) against the client-provided hex signature.
function hmacMatches(secret: string, raw: string, provided: string): boolean {
  if (!provided) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

// Pull the presented token from the request (header or Bearer).
function readToken(req: Request): string {
  return (
    req.headers.get('x-ingest-token') ??
    (req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '')
  );
}

export type IngestAuthResult =
  | { ok: true }
  // 503 — no secret is configured for the tier this route requires.
  | { ok: false; status: 503; error: 'ingest not configured' }
  // 401 — credentials presented but none matched any accepted secret.
  | { ok: false; status: 401; error: 'invalid credentials' };

/**
 * Core verifier. Authorizes the request if it matches ANY of `accepted`
 * secrets, via token OR HMAC. `accepted` is the list of secret VALUES this
 * route will honour (order is irrelevant; falsy entries are ignored).
 *
 *   - 503 if NONE of the relevant secrets are configured (all falsy).
 *   - 401 if at least one secret is configured but the request matched none.
 *   - ok  otherwise.
 *
 * `raw` MUST be the exact request body bytes (read once via `await req.text()`)
 * so an HMAC is verified over precisely what the client signed.
 */
export function verifyIngest(
  req: Request,
  raw: string,
  accepted: ReadonlyArray<string | undefined>
): IngestAuthResult {
  const secrets = accepted.filter((s): s is string => Boolean(s));
  if (secrets.length === 0) {
    return { ok: false, status: 503, error: 'ingest not configured' };
  }

  const token = readToken(req);
  const sig = req.headers.get('x-ingest-signature') ?? '';

  for (const secret of secrets) {
    if (token && timingSafeEqualStr(token, secret)) return { ok: true };
    if (hmacMatches(secret, raw, sig)) return { ok: true };
  }
  return { ok: false, status: 401, error: 'invalid credentials' };
}

/**
 * REPORT tier — least privilege. Accepts the dedicated `OPS_REPORT_TOKEN` OR the
 * privileged `OPS_INGEST_SECRET`. For /api/ingest/issue ONLY.
 */
export function verifyReportIngest(req: Request, raw: string): IngestAuthResult {
  return verifyIngest(req, raw, [
    process.env.OPS_REPORT_TOKEN,
    process.env.OPS_INGEST_SECRET,
  ]);
}

/**
 * PRIVILEGED tier. Accepts ONLY `OPS_INGEST_SECRET`. For every ingest route
 * other than /api/ingest/issue. Never satisfiable by the browser report token.
 */
export function verifyPrivilegedIngest(req: Request, raw: string): IngestAuthResult {
  return verifyIngest(req, raw, [process.env.OPS_INGEST_SECRET]);
}

/**
 * SUPPORT-INTAKE tier — least privilege, browser-facing. Accepts the dedicated
 * `OPS_SUPPORT_TOKEN` (the token that ships in the public support-chat widget,
 * so it must grant the minimum: "open/continue a support conversation") OR the
 * privileged `OPS_INGEST_SECRET` for server-side callers. For the P2 customer
 * chat surface at /api/public/support/* ONLY.
 */
export function verifySupportIntake(req: Request, raw: string): IngestAuthResult {
  return verifyIngest(req, raw, [
    process.env.OPS_SUPPORT_TOKEN,
    process.env.OPS_INGEST_SECRET,
  ]);
}

/**
 * EMAIL-INTAKE tier — server-to-server. Accepts the dedicated `OPS_EMAIL_TOKEN`
 * (presented by the Cloudflare Email Routing worker / provider webhook) OR the
 * privileged `OPS_INGEST_SECRET`, via token OR HMAC. For /api/ingest/email ONLY.
 * This token is never placed in a browser, so it stays a server secret.
 */
export function verifyEmailIngest(req: Request, raw: string): IngestAuthResult {
  return verifyIngest(req, raw, [
    process.env.OPS_EMAIL_TOKEN,
    process.env.OPS_INGEST_SECRET,
  ]);
}

/**
 * BOT tier. Accepts ONLY `OPS_BOT_TOKEN` (token OR HMAC). For the `/api/bot/*`
 * surface consumed by the Discord bot — a parallel, single-token surface kept
 * separate from `OPS_INGEST_SECRET` so a compromised bot host can be cut off by
 * rotating this one token without disturbing estate-app / CI ingest.
 */
export function verifyBotIngest(req: Request, raw: string): IngestAuthResult {
  return verifyIngest(req, raw, [process.env.OPS_BOT_TOKEN]);
}

/**
 * PRIVILEGED, HMAC-ONLY tier. Accepts ONLY an `OPS_INGEST_SECRET` HMAC signature
 * (no plaintext token) — for the scanner webhook at /api/ops/ingest/[source],
 * whose callers always sign the raw body and never present a shared token in
 * plaintext. 503 if the secret is unset; 401 on a missing/mismatched signature.
 */
export function verifyPrivilegedHmac(req: Request, raw: string): IngestAuthResult {
  const secret = process.env.OPS_INGEST_SECRET;
  if (!secret) {
    return { ok: false, status: 503, error: 'ingest not configured' };
  }
  const sig = req.headers.get('x-ingest-signature') ?? '';
  if (hmacMatches(secret, raw, sig)) return { ok: true };
  return { ok: false, status: 401, error: 'invalid credentials' };
}
