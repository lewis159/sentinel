// Create a related ITIL record from a source ticket and link the two.
// Gated by requireOpsAuth().
//
//   POST /api/tickets/INC-0001/related { kind: 'problem' | 'change' }
//     → { ok, ref: '<newRef>' }
//
// Used by the Details panel "Elevate to problem" / "Create change" actions:
// mints a new ticket of the given kind (copying app + impact/urgency + a sensible
// title/description) and writes an ops.links row source→new so the new record
// shows up in the source's Linked records panel.

import { requireOpsAuth } from '@/lib/auth';
import { createRelatedTicket } from '@/lib/data';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['problem', 'change']);

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

  const kind = typeof body?.kind === 'string' ? body.kind : '';
  if (!ALLOWED.has(kind)) {
    return Response.json(
      { ok: false, error: "kind must be 'problem' or 'change'" },
      { status: 400 }
    );
  }

  try {
    const result = await createRelatedTicket(ref, kind as 'problem' | 'change');
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error ?? 'create failed' }, { status: 400 });
    }
    return Response.json({ ok: true, ref: result.ref });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'create failed' }, { status: 500 });
  }
}
