// Customer support CHAT intake — the P2 "customer talks to us" path.
//
// The public support-chat widget (public/support-chat.js, dropped into
// scribuo.com) POSTs here. It is NOT Clerk-gated (customers have no Clerk session
// against Sentinel) — it lives in the middleware PUBLIC matcher and authenticates
// in-route with the least-privilege `OPS_SUPPORT_TOKEN` (token OR HMAC; the
// privileged `OPS_INGEST_SECRET` is also accepted for server-side callers).
//
// Behind HERMES_INTAKE_ENABLED — OFF by default, so this surface is inert until
// explicitly enabled (the shipped app is unaffected).
//
//   POST /api/public/support/chat
//   body: { conversationId?, message, email?, name?, tenantRef?, escalate? }
//   → 200 { reply, chunks, ticketRef, conversationId, escalated, confidence }
//
// Flow:
//   1. find-or-create a Sentinel ticket (source:'web', kind:'request'). The
//      ticketRef IS the conversationId, so the widget threads by echoing it back.
//   2. append the customer message as a ticket comment (kind:'customer').
//   3. on explicit escalate OR low confidence → mark the ticket for a human
//      (status:'in_progress', priority bump, attrs.needs_human) so it surfaces in
//      the support queue.
//   4. otherwise run the DRAFT-ONLY support copilot (runCopilotProposal) for an
//      L1 grounded (KB) answer, append it as a comment (kind:'ai-reply'), and
//      return it to the customer.
//
// SHARED CONTRACT: customer/tenant identity is carried ONLY on attrs —
// attrs.tenant_ref (Clerk org id if signed in, else null), attrs.customer_email,
// attrs.customer_name. We never alter ops.tickets DDL or createTicket's signature.

import { createTicket, getServiceTicket, addTicketComment, updateTicket } from '@/lib/data';
import { verifySupportIntake } from '@/lib/ingest-auth';
import { intakeEnabled } from '@/lib/hermes/brain/flags';
import { runCopilotProposal } from '@/lib/hermes/brain/copilot';
import type { Severity } from '@/lib/mock';

export const dynamic = 'force-dynamic';

// CORS: the widget fetches from the customer app's origin (scribuo.com). The
// token/HMAC is the real access control; CORS just lets the browser fetch succeed.
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

// Confidence (0-100) at/under which an L1 answer is treated as not good enough to
// stand alone: the ticket is flagged for a human even though we still show the draft.
const LOW_CONFIDENCE = 45;

// Split a long reply into readable chunks on paragraph boundaries, then hard-wrap
// any oversized paragraph, so the widget can render multiple bubbles.
function chunkReply(text: string, max = 600): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras.length ? paras : [text]) {
    if (p.length <= max) { out.push(p); continue; }
    let rest = p;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut < max * 0.5) cut = max; // no good space — hard cut
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out.length ? out : [text];
}

// Map the copilot's priority word to a Sentinel Severity band.
function toSeverity(p?: string): Severity {
  switch ((p ?? '').toLowerCase()) {
    case 'urgent': return 'critical';
    case 'high': return 'high';
    case 'low': return 'low';
    default: return 'medium';
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export async function POST(req: Request) {
  const raw = await req.text();

  const authed = verifySupportIntake(req, raw);
  if (!authed.ok) return json({ error: authed.error }, authed.status);

  if (!intakeEnabled()) {
    return json({ error: 'support intake disabled' }, 503);
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: 'invalid JSON body' }, 400); }

  const message = str(body?.message);
  if (!message) return json({ error: 'message is required' }, 400);

  const email = str(body?.email);
  const name = str(body?.name);
  const tenantRef = str(body?.tenantRef) ?? null; // Clerk org id if signed in, else null
  const escalate = body?.escalate === true;
  const requestedConversationId = str(body?.conversationId);

  // Identity carried ONLY through attrs (the shared multi-tenant contract).
  const identityAttrs = {
    tenant_ref: tenantRef,
    customer_email: email ?? null,
    customer_name: name ?? null,
  };

  try {
    // --- 1. Find-or-create the conversation ticket -------------------------
    // conversationId IS the ticketRef. Reuse it if it still resolves; otherwise
    // (first turn, or a stale/unknown id) mint a fresh support ticket.
    let ref: string | undefined;
    if (requestedConversationId) {
      const { row } = await getServiceTicket(requestedConversationId);
      if (row) ref = row.ref;
    }

    if (!ref) {
      const title = message.length > 80 ? `${message.slice(0, 77)}…` : message;
      const created = await createTicket({
        kind: 'request',
        title,
        description: message,
        app: str(body?.app) ?? 'Scribuo',
        impact: 'medium',
        urgency: 'medium',
        status: 'new', // support-queue inbox state
        source: 'web',
        attrs: {
          ...identityAttrs,
          channel: 'web-chat',
        },
      });
      ref = created.ref;
    } else {
      // Existing conversation: keep identity attrs fresh (e.g. email added later).
      await updateTicket(ref, { attrs: identityAttrs });
    }

    // --- 2. Record the customer's message ----------------------------------
    await addTicketComment(ref, message, name ?? email ?? 'Customer', 'customer');

    // --- 3. Explicit escalation → hand to a human, no L1 draft -------------
    if (escalate) {
      await updateTicket(ref, {
        status: 'in_progress',
        priority: 'high',
        attrs: { ...identityAttrs, needs_human: true, escalated_at: new Date().toISOString(), escalated_via: 'customer' },
      });
      const reply =
        'Thanks — I’ve passed this to a member of our team, who will follow up' +
        (email ? ` by email at ${email}` : ' shortly') +
        `. Your reference is ${ref}.`;
      await addTicketComment(ref, reply, 'Hermes · Support', 'ai-reply');
      return json({ reply, chunks: [reply], ticketRef: ref, conversationId: ref, escalated: true, confidence: null });
    }

    // --- 4. L1 grounded answer via the DRAFT-ONLY support copilot ----------
    const proposal = await runCopilotProposal({
      persona: 'support',
      input: { ref, title: message, description: message, priority: 'medium', status: 'new' },
    });

    const draft = str(proposal.draft);
    const confidence = typeof proposal.confidence === 'number' ? proposal.confidence : null;
    const lowConfidence = confidence !== null && confidence <= LOW_CONFIDENCE;
    const answered = proposal.ok && Boolean(draft) && !lowConfidence;

    if (answered && draft) {
      await addTicketComment(ref, draft, 'Hermes · Support', 'ai-reply');
      if (proposal.priority) {
        // Keep the ticket's priority in step with the copilot's read (no status change).
        await updateTicket(ref, { priority: toSeverity(proposal.priority) });
      }
      return json({
        reply: draft,
        chunks: chunkReply(draft),
        ticketRef: ref,
        conversationId: ref,
        escalated: false,
        confidence,
      });
    }

    // No usable answer (model off, parse failure, or low confidence) → flag for a
    // human and return a soft holding reply. The draft (if any) is still stored
    // as a comment so a human sees what was attempted.
    if (draft) await addTicketComment(ref, draft, 'Hermes · Support', 'ai-draft');
    await updateTicket(ref, {
      status: 'in_progress',
      attrs: {
        ...identityAttrs,
        needs_human: true,
        escalated_at: new Date().toISOString(),
        escalated_via: lowConfidence ? 'low_confidence' : 'unanswered',
      },
    });
    const holding =
      'Thanks for your message. I want to make sure you get the right answer, so I’ve ' +
      'passed this to a member of our team who will follow up' +
      (email ? ` at ${email}` : ' shortly') +
      `. Your reference is ${ref}.`;
    await addTicketComment(ref, holding, 'Hermes · Support', 'ai-reply');
    return json({
      reply: holding,
      chunks: [holding],
      ticketRef: ref,
      conversationId: ref,
      escalated: true,
      confidence,
    });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'chat intake failed' }, 500);
  }
}
