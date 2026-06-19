// Linked records for one ITIL ticket — reads ops.links (both directions) and
// returns the "other" node of each edge. Gated by requireOpsAuth(). DB-only; on
// no-DB or no rows the client renders a "No linked records" state.
//
//   GET /api/tickets/INC-0001/links → { ok, links: [{ rel, type, id, label, href }] }

import { requireOpsAuth } from '@/lib/auth';
import { getTicketEdges } from '@/lib/data';

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
