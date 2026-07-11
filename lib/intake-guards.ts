// Shared HARDENING helpers for the P2 public intake surface (support chat, KB
// search, email-to-ticket). Centralises the guards that every public route must
// apply BEFORE it does any DB or LLM work:
//   • clientIp()        — best-effort caller IP for per-IP rate limiting.
//   • corsHeaders()     — origin-scoped CORS (allowlist via env, not blanket '*').
//   • assertContentType — reject non-JSON POST bodies (415).
//   • body/size caps    — reject oversized payloads early (413).
//   • zod schemas       — validate + bound every field before use.
//   • stripHtml()       — never store raw inbound HTML as a comment body.
//
// Env knobs (all optional; safe defaults chosen for a small support desk):
//   SUPPORT_CORS_ALLOWED_ORIGINS  comma-separated origin allowlist for the browser
//                                 widget. UNSET → '*' (preserves current behaviour;
//                                 setting it is a FLAGGED recommendation).
//   INTAKE_CHAT_RPM   / default 20   per-IP requests/min for /support/chat (LLM-cost)
//   INTAKE_KB_RPM     / default 60   per-IP requests/min for /support/kb
//   INTAKE_EMAIL_RPM  / default 120  GLOBAL requests/min for /ingest/email
//   INTAKE_MAX_BODY_BYTES / default 65536 (chat/kb)  hard body-size cap
//   INTAKE_EMAIL_MAX_BODY_BYTES / default 524288     hard body-size cap for email

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Size / length caps (bytes for bodies, characters for fields).
// ---------------------------------------------------------------------------

const num = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

export const CAPS = {
  get chatBodyBytes() { return num(process.env.INTAKE_MAX_BODY_BYTES, 64 * 1024); },
  get kbBodyBytes() { return num(process.env.INTAKE_MAX_BODY_BYTES, 64 * 1024); },
  get emailBodyBytes() { return num(process.env.INTAKE_EMAIL_MAX_BODY_BYTES, 512 * 1024); },
  message: 8000,        // chat message
  query: 400,           // kb search query
  email: 320,           // RFC-ish practical max
  name: 200,
  tenantRef: 200,
  conversationId: 128,
  app: 80,
  subject: 1000,
  emailText: 100_000,   // stored email body (after html→text)
  messageId: 998,       // RFC 5322 line length
  maxThreadIds: 20,     // bound the In-Reply-To/References fan-out used for threading
} as const;

// ---------------------------------------------------------------------------
// Rate-limit config per route (read from env at call time).
// ---------------------------------------------------------------------------

export const RATE = {
  get chatPerMin() { return num(process.env.INTAKE_CHAT_RPM, 20); },
  get kbPerMin() { return num(process.env.INTAKE_KB_RPM, 60); },
  get emailPerMin() { return num(process.env.INTAKE_EMAIL_RPM, 120); },
  windowMs: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Caller IP — best-effort, for per-IP throttling only (never for authz).
// Honours the proxy chain we actually sit behind (Cloudflare → NPM → app).
// ---------------------------------------------------------------------------

export function clientIp(req: Request): string {
  const h = req.headers;
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim(); // left-most = original client
  const xr = h.get('x-real-ip');
  if (xr) return xr.trim();
  return 'unknown';
}

// ---------------------------------------------------------------------------
// CORS — scoped to an allowlist when configured, otherwise '*' (no credentials).
// We never set Access-Control-Allow-Credentials, so a token in the widget can be
// used cross-origin only by sites we allow (and by non-browser clients, which
// CORS cannot stop — the token remains the real control).
// ---------------------------------------------------------------------------

function allowedOrigins(): string[] {
  return (process.env.SUPPORT_CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(req: Request, methods: string): Record<string, string> {
  const allow = allowedOrigins();
  const origin = req.headers.get('origin') ?? '';
  // Unset allowlist → preserve legacy '*' behaviour. Configured → reflect only
  // an allowed origin; otherwise pin to the first allowed value so a disallowed
  // browser origin is blocked by the mismatch.
  const acao = allow.length === 0 ? '*' : allow.includes(origin) ? origin : allow[0]!;
  return {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, x-ingest-token, x-ingest-signature, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

// ---------------------------------------------------------------------------
// Body reading with a hard byte cap, applied BEFORE JSON.parse / auth work.
// Checks the declared Content-Length first (cheap reject), then the real bytes.
// ---------------------------------------------------------------------------

export interface CappedBody {
  raw: string;
  tooLarge: boolean;
}

export async function readCappedText(req: Request, maxBytes: number): Promise<CappedBody> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { raw: '', tooLarge: true };
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { raw: '', tooLarge: true };
  }
  return { raw, tooLarge: false };
}

// Require a JSON content-type on POST bodies. Lenient only for an empty body.
export function isJsonContentType(req: Request): boolean {
  const ct = (req.headers.get('content-type') ?? '').toLowerCase();
  return ct.includes('application/json');
}

// ---------------------------------------------------------------------------
// HTML → text. Inbound email may be HTML-only; we NEVER persist raw markup as a
// comment body (defence-in-depth against a future markdown/HTML renderer on the
// ticket view — today React escapes it, but the store should stay clean).
// ---------------------------------------------------------------------------

export function stripHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ') // drop script/style content
    .replace(/<[^>]+>/g, ' ') // strip remaining tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Zod schemas — validate + bound every client-controlled field. Unknown keys are
// stripped. tenantRef / customer_email are accepted as UNTRUSTED hints only: they
// are written to attrs and never used to READ another tenant's data.
// ---------------------------------------------------------------------------

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const chatBodySchema = z.object({
  message: trimmed(CAPS.message),
  conversationId: trimmed(CAPS.conversationId).optional(),
  email: z.string().trim().max(CAPS.email).email().optional().or(z.literal('')),
  name: z.string().trim().max(CAPS.name).optional(),
  tenantRef: z.string().trim().max(CAPS.tenantRef).optional(),
  app: z.string().trim().max(CAPS.app).optional(),
  escalate: z.boolean().optional(),
}).strip();

export const kbBodySchema = z.object({
  q: z.string().trim().max(CAPS.query).optional(),
  limit: z.coerce.number().int().min(1).max(8).optional(),
}).strip();

export const emailBodySchema = z.object({
  subject: z.string().trim().max(CAPS.subject).optional(),
  from: z.string().trim().max(CAPS.email + CAPS.name + 8).optional(),
  to: z.string().trim().max(CAPS.email + CAPS.name + 8).optional(),
  text: z.string().max(CAPS.emailText).optional(),
  body: z.string().max(CAPS.emailText).optional(),
  html: z.string().max(CAPS.emailBodyBytes).optional(),
  messageId: z.string().trim().max(CAPS.messageId).optional(),
  inReplyTo: z.string().trim().max(CAPS.messageId).optional(),
  references: z.any().optional(),
  headers: z.record(z.string(), z.any()).optional(),
  tenantRef: z.string().trim().max(CAPS.tenantRef).optional(),
  name: z.string().trim().max(CAPS.name).optional(),
  app: z.string().trim().max(CAPS.app).optional(),
}).strip();

// Parse & bound a References / In-Reply-To id list to at most `maxThreadIds`
// well-formed ids, so an attacker cannot force a huge jsonb `?|` scan.
export function boundThreadIds(inReplyTo: string | undefined, references: string[]): string[] {
  const all = [inReplyTo, ...references]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0 && s.length <= CAPS.messageId);
  // De-dupe, cap length.
  return Array.from(new Set(all)).slice(0, CAPS.maxThreadIds);
}
