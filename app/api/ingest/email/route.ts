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
  const raw = await req.text();

  const authed = verifyEmailIngest(req, raw);
  if (!authed.ok) return json({ error: authed.error }, authed.status);

  if (!intakeEnabled()) return json({ error: 'email intake disabled' }, 503);

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: 'invalid JSON body' }, 400); }

  // Normalize across Cloudflare-worker JSON and common header-name variants.
  const headers = (body?.headers && typeof body.headers === 'object') ? body.headers : {};
  const subject = str(body?.subject) ?? str(headers['subject']) ?? '(no subject)';
  const from = str(body?.from) ?? str(headers['from']);
  const text = str(body?.text) ?? str(body?.body) ?? str(body?.html) ?? '';
  const messageId = str(body?.messageId) ?? str(body?.['message-id']) ?? str(headers['message-id']) ?? '';
  const inReplyTo = str(body?.inReplyTo) ?? str(body?.['in-reply-to']) ?? str(headers['in-reply-to']);
  const references = parseRefs(body?.references ?? headers['references']);

  if (!from) return json({ error: 'from is required' }, 400);

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
    const threadIds = [inReplyTo, ...references].filter(Boolean) as string[];
    const existing = threadIds.length ? await findTicketByEmailMessageIds(threadIds) : null;

    if (existing) {
      const commentBody = `Re: ${subject}\n\n${messageBody}`;
      await addTicketComment(existing.ref, commentBody, name ?? fromEmail ?? 'Customer', 'customer');
      if (messageId) await appendEmailMessageId(existing.ref, messageId);
      return json({ ok: true, ref: existing.ref, threaded: true }, 201);
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
          await addTicketComment(ref, proposal.draft as string, 'Hermes · Support', 'ai-draft');
        }
      } catch {
        /* draft is best-effort; the ticket already exists */
      }
    }

    return json({ ok: true, ref, threaded: false }, 201);
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'email ingest failed' }, 500);
  }
}
