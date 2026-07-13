// Customer portal — submit a new support request.
//
//   POST /api/portal/tickets  body { subject, body }  → 201 { ok, ref }
//
// SECURITY:
//   * Must be signed in WITH an active tenant (getPortalSession).
//   * The new ticket is OWNED by the caller's SESSION tenant — tenantRef is set
//     server-side from the session, never from the request body. A client cannot
//     create a ticket under another tenant.
//   * Sensible fixed defaults: kind='request', status='open', source='portal'.

import { getPortalSession } from '@/lib/portal/auth';
import { createTicket } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getPortalSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const subject = typeof payload?.subject === 'string' ? payload.subject.trim() : '';
  const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
  if (!subject) {
    return Response.json({ error: 'subject is required' }, { status: 400 });
  }

  try {
    const { ref } = await createTicket({
      kind: 'request',
      title: subject,
      description: body || undefined,
      status: 'open',
      source: 'portal',
      // Ownership is server-derived. Never read from the request body.
      tenantRef: session.tenantRef,
      customerEmail: session.email ?? undefined,
    });
    return Response.json({ ok: true, ref }, { status: 201 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'create failed' }, { status: 500 });
  }
}
