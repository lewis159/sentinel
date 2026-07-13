// Customer portal — post a reply to one of the caller's own tickets.
//
//   POST /api/portal/tickets/INC-0001/comments  body { body }  → 201 { ok, comment }
//
// SECURITY (re-enforced here, never trusting the page):
//   1. requirePortalSession-equivalent: must be signed in WITH an active tenant.
//   2. IDOR: the ref must resolve to a ticket owned by the caller's tenant
//      (getPortalTicket scoped to session tenant). Not owned / not found → 404,
//      the SAME response, so ticket existence is never leaked across tenants.
//   3. The stored comment is FORCED to kind='customer', visibility='external'
//      server-side — any client-supplied kind/visibility is ignored, so a
//      customer can never write an internal operator note.

import { getPortalSession } from '@/lib/portal/auth';
import { getPortalTicket } from '@/lib/portal/tickets';
import { addTicketComment } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getPortalSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { ref } = await params;

  // IDOR gate — only proceed if this ref belongs to the caller's tenant. A
  // cross-tenant or unknown ref is indistinguishable: both 404.
  const ticket = await getPortalTicket(ref, session.tenantRef);
  if (!ticket) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const text = typeof payload?.body === 'string' ? payload.body.trim() : '';
  if (!text) {
    return Response.json({ error: 'body is required' }, { status: 400 });
  }

  // Author label = the customer's email (falls back to their user id). NEVER
  // trust a client-supplied author/kind/visibility — kind and visibility are
  // hard-coded so a customer reply is always an EXTERNAL customer message.
  const author = session.email ?? session.userId;

  try {
    const comment = await addTicketComment(ticket.ref, text, author, 'customer', 'external');
    if (!comment) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return Response.json({ ok: true, comment }, { status: 201 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'post failed' }, { status: 500 });
  }
}
