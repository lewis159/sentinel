// Ticket write API — update (PATCH). Operator-facing; gated by requireOpsAuth().
//
//   PATCH /api/tickets/INC-0001
//   body: { status?, assignee?, priority?, impact?, urgency?, attrs? }
//   → 200 { ok: true, ticket }  (assignee + attrs are merged into attrs jsonb)

import { requireOpsAuth } from '@/lib/auth';
import { updateTicket, type UpdateTicketInput } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { ref } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const patch: UpdateTicketInput = {
    status: typeof body?.status === 'string' ? body.status : undefined,
    assignee: typeof body?.assignee === 'string' ? body.assignee : undefined,
    priority: typeof body?.priority === 'string' ? body.priority : undefined,
    impact: typeof body?.impact === 'string' ? body.impact : undefined,
    urgency: typeof body?.urgency === 'string' ? body.urgency : undefined,
    attrs: body?.attrs && typeof body.attrs === 'object' ? body.attrs : undefined,
  };

  try {
    const { row } = await updateTicket(ref, patch);
    if (!row) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, ticket: row });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'update failed' }, { status: 500 });
  }
}
