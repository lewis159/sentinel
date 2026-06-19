// Linked records for one ITIL ticket — reads ops.links (both directions) and
// returns the "other" node of each edge. Gated by requireOpsAuth(). DB-only; on
// no-DB or no rows the client renders a "No linked records" state.
//
//   GET  /api/tickets/INC-0001/links → { ok, links: [{ rel, type, id, label, href }] }
//   POST /api/tickets/INC-0001/links { targetRef, relation? } → { ok }
//     Links this ticket to an existing ticket (idempotent on the unique key).

import { requireOpsAuth } from '@/lib/auth';
import { getTicketEdges, linkTicketToTicket } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { ref } = await params;
  try {
    const links = await getTicketEdges(ref);
    return Response.json({ ok: true, links });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'failed' }, { status: 500 });
  }
}

export async function POST(
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
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const targetRef = typeof body?.targetRef === 'string' ? body.targetRef.trim() : '';
  const relation = typeof body?.relation === 'string' && body.relation.trim()
    ? body.relation.trim()
    : 'related';

  if (!targetRef) {
    return Response.json({ ok: false, error: 'targetRef is required' }, { status: 400 });
  }
  if (targetRef === ref) {
    return Response.json({ ok: false, error: 'cannot link a ticket to itself' }, { status: 400 });
  }

  try {
    const result = await linkTicketToTicket(ref, targetRef, relation);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error ?? 'link failed' }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'link failed' }, { status: 500 });
  }
}
