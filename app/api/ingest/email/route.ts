// Email-to-ticket ingest — the "customer emails support → Sentinel ticket" path.
//
// Shaped for Cloudflare Email Routing → Email Worker → webhook (the worker parses
// the inbound message and POSTs a small JSON body here), and for any generic
// provider that can POST a normalized email payload. NOT Clerk-gated (in the
// middleware PUBLIC matcher); authenticates in-route with the least-privilege
// `OPS_EMAIL_TOKEN` (token OR HMAC), or the privileged `OPS_INGEST_SECRET`.
//
// Behind HERMES_INTAKE_ENABLED — OFF by default (surface inert until enabled).
//
//   POST /api/ingest/email
//   body (normalized; header-name fallbacks accepted):
//     { subject, from, to?, text?, html?, messageId, inReplyTo?, references?,
//       tenantRef?, name? }
//   → 201 { ok, ref, threaded }
//
// Threading: if In-Reply-To / References match a ticket we've already seen (its
// attrs.email_message_ids), the message is appended as a comment on THAT ticket;
// otherwise a new kind='request', source='email' ticket is created. Every seen
// Message-ID is recorded in attrs.email_message_ids so later replies converge.
//
// SHARED CONTRACT: customer identity lives ONLY on attrs — attrs.tenant_ref
// (null for anonymous inbound email), attrs.customer_email, attrs.customer_name.
// No ops.tickets DDL change, no createTicket signature change.
//
// Optionally (when OPENROUTER is configured) an L1 DRAFT is produced by the
// draft-only support copilot and stored as a comment (kind:'ai-draft') for a
// human to review/send — it is never sent to the customer from here.

import { createTicket, addTicketComment, findTicketByEmailMessageIds, appendEmailMessageId } from '@/lib/data';
import { verifyEmailIngest } from '@/lib/ingest-auth';
import { intakeEnabled } from '@/lib/hermes/brain/flags';
import { runCopilotProposal } from '@/lib/hermes/brain/copilot';
import {
  corsHeaders, readCappedText, isJsonContentType, stripHtml,
  emailBodySchema, boundThreadIds, CAPS, RATE,
} from '@/lib/intake-guards';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const METHODS = 'POST, OPTIONS';

function json(req: Request, body: unknown, status = 200, extra?: Record<string, string>) {
  return Response.json(body, { status, headers: { ...corsHeaders(req, METHODS), ...extra } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req, METHODS) });
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

// Parse "Ben Percival <ben@x.com>" → { name, email }; also handles a bare address.
function parseFrom(from?: string): { name?: string; email?: string } {
  if (!from) return {};
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: str(m[1]), email: str(m[2]) };
  const bare = from.trim();
  return /@/.test(bare) ? { email: bare } : { name: bare };
}

// References is a space/comma-separated list of Message-IDs; split into an array.
function parseRefs(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean) as string[];
  if (typeof v === 'string') return v.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

export async function POST(req: Request) {
  // 1. Content-type + size cap before any auth / DB / LLM work.
  if (!isJsonContentType(req)) return json(req, { error: 'content-type must be application/json' }, 415);
  const { raw, tooLarge } = await readCappedText(req, CAPS.emailBodyBytes);
  if (tooLarge) return json(req, { error: 'payload too large' }, 413);

  // 2. Auth FIRST (this is a server-to-server webhook; the CF Email Worker holds
  // OPS_EMAIL_TOKEN). Auth before rate limit so an UNauthenticated flood cannot
  // exhaust the shared global bucket and DoS legitimate inbound email.
  const authed = verifyEmailIngest(req, raw);
  if (!authed.ok) return json(req, { error: authed.error }, authed.status);

  if (!intakeEnabled()) return json(req, { error: 'email intake disabled' }, 503);

  // 3. GLOBAL rate limit (not per-IP: all mail arrives from the one worker IP).
  // Bounds ticket-spam even if OPS_EMAIL_TOKEN leaks. Per-instance only.
  const rl = checkRateLimit('email:global', { limit: RATE.emailPerMin, windowMs: RATE.windowMs });
  if (!rl.ok) return json(req, { error: 'rate limit exceeded' }, 429, { 'Retry-After': String(rl.retryAfterSec) });

  // 4. Parse + validate/bound. Unknown keys stripped; oversized fields rejected.
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(raw); } catch { return json(req, { error: 'invalid JSON body' }, 400); }
  const parsed = emailBodySchema.safeParse(parsedJson);
  if (!parsed.success) return json(req, { error: 'invalid request' }, 400);
  const body: any = parsed.data;

  // Normalize across Cloudflare-worker JSON and common header-name variants.
  const headers = (body?.headers && typeof body.headers === 'object') ? body.headers : {};
  const subject = (str(body?.subject) ?? str(headers['subject']) ?? '(no subject)').slice(0, CAPS.subject);
  const from = str(body?.from) ?? str(headers['from']);
  // Prefer plain text; if only HTML is provided, strip tags — NEVER store raw
  // inbound markup as a comment body. Cap the stored length.
  const rawText = str(body?.text) ?? str(body?.body);
  const htmlText = str(body?.html) ? stripHtml(str(body?.html)!) : undefined;
  const text = (rawText ?? htmlText ?? '').slice(0, CAPS.emailText);
  const messageId = (str(body?.messageId) ?? str(body?.['message-id']) ?? str(headers['message-id']) ?? '').slice(0, CAPS.messageId);
  const inReplyTo = str(body?.inReplyTo) ?? str(body?.['in-reply-to']) ?? str(headers['in-reply-to']);
  const references = parseRefs(body?.references ?? headers['references']);

  if (!from) return json(req, { error: 'from is required' }, 400);

  const { name: fromName, email: fromEmail } = parseFrom(from);
  const name = str(body?.name) ?? fromName;
  const tenantRef = str(body?.tenantRef) ?? null; // inbound email is anonymous → null

  const identityAttrs = {
    tenant_ref: tenantRef,
    customer_email: fromEmail ?? from,
    customer_name: name ?? null,
  };

  // Body text for the ticket/comment. Empty bodies still create a record (the
  // subject carries the request); keep the original message-id for audit.
  const messageBody = text || '(empty email body)';

  try {
    // --- Threading: append to an existing ticket if this is a reply ---------
    // Bound the In-Reply-To/References fan-out so a crafted email cannot force a
    // huge jsonb `?|` scan (CAPS.maxThreadIds, well-formed + de-duped).
    const threadIds = boundThreadIds(inReplyTo, references);
    const existing = threadIds.length ? await findTicketByEmailMessageIds(threadIds) : null;

    if (existing) {
      const commentBody = `Re: ${subject}\n\n${messageBody}`;
      // Inbound customer email is part of the customer-visible thread → external.
      await addTicketComment(existing.ref, commentBody, name ?? fromEmail ?? 'Customer', 'customer', 'external');
      if (messageId) await appendEmailMessageId(existing.ref, messageId);
      return json(req, { ok: true, ref: existing.ref, threaded: true }, 201);
    }

    // --- New ticket ---------------------------------------------------------
    const { ref } = await createTicket({
      kind: 'request',
      title: subject,
      description: messageBody,
      app: str(body?.app) ?? 'Scribuo',
      impact: 'medium',
      urgency: 'medium',
      status: 'new', // support-queue inbox state
      source: 'email',
      attrs: {
        ...identityAttrs,
        channel: 'email',
        subject,
        root_message_id: messageId || null,
        email_message_ids: messageId ? [messageId] : [],
      },
    });

    // --- Optional draft-only L1 assist (into the comment path, never sent) ---
    // Only when a model is configured; failures are swallowed (the ticket stands).
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const proposal = await runCopilotProposal({
          persona: 'support',
          input: { ref, title: subject, description: messageBody, priority: 'medium', status: 'new' },
        });
        if (proposal.ok && str(proposal.draft)) {
          // Draft-only assist — never auto-sent to the customer → internal (default).
          await addTicketComment(ref, proposal.draft as string, 'Hermes · Support', 'ai-draft', 'internal');
        }
      } catch {
        /* draft is best-effort; the ticket already exists */
      }
    }

    return json(req, { ok: true, ref, threaded: false }, 201);
  } catch (e: any) {
    // Never leak internal error detail to the caller.
    console.error('[ingest/email] ingest failed:', e?.message ?? e);
    return json(req, { ok: false, error: 'email ingest failed' }, 500);
  }
}
