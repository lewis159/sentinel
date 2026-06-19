// CAB decision API — approve/reject a change's CAB review. Operator-facing;
// gated by requireOpsAuth().
//
//   POST /api/changes/CHG-0001/cab
//   body: { decision: 'approve' | 'reject' }
//   → 200 { ok: true, ref, cab_status, status }
//
// Self-contained (the service-management write API in /api/tickets is owned
// elsewhere): updates attrs.cab_status via a local `q` call and, on approval,
// advances a draft/awaiting_cab change to 'approved'; on rejection sends it
// back to 'draft'. Falls back gracefully when there is no DB.

import { requireOpsAuth } from '@/lib/auth';
import { hasDb, q1 } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TICKET_COLS =
  'ref,kind,title,description,status,priority,impact,urgency,app,source,sla_due,opened_at,created_at,attrs';

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
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const decision = body?.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    return Response.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }

  if (!hasDb) {
    return Response.json({ ok: false, error: 'no DB' }, { status: 503 });
  }

  const cabStatus = decision === 'approve' ? 'approved' : 'rejected';
  // Approving a change moves it forward to 'approved'; rejecting returns it to
  // draft for rework. Only nudge the lifecycle status when it's still in the
  // pre-approval band so we never clobber a later state.
  const nextStatus = decision === 'approve' ? 'approved' : 'draft';

  try {
    const row = await q1<any>(
      `update ops.tickets
         set attrs = ops.tickets.attrs || $2::jsonb,
             status = case when kind='change' and status in ('draft','awaiting_cab')
                           then $3 else status end
       where ref=$1 and kind='change'
       returning ${TICKET_COLS}`,
      [ref, JSON.stringify({ cab_status: cabStatus }), nextStatus]
    );
    if (!row) return Response.json({ ok: false, error: 'change not found' }, { status: 404 });
    return Response.json({ ok: true, ref: row.ref, cab_status: cabStatus, status: row.status });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'update failed' }, { status: 500 });
  }
}
