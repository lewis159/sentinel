// Open incidents for the monitoring dashboard's OpenIncidentsWidget. Clerk-gated
// via requireOpsAuth(); reads ops.tickets (kind=incident) server-side via
// getTicketsByKind and returns the open count + a short list. `live` reflects
// whether the data came from the DB (vs the mock fallback).
//
//   GET /api/metrics/incidents → { ok, live, openCount, items: [...] }

import { requireOpsAuth } from '@/lib/auth';
import { getTicketsByKind } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Statuses that count as "open / active" for an incident.
const OPEN_STATUSES = new Set(['open', 'in_progress', 'investigating']);

export async function GET() {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { rows, live } = await getTicketsByKind('incident');
  const open = rows.filter((t) => OPEN_STATUSES.has(t.status));
  const items = open
    .slice(0, 8)
    .map((t) => ({ ref: t.ref, title: t.title, priority: t.priority, status: t.status, app: t.app, age: t.age }));

  return Response.json({ ok: true, live, openCount: open.length, items });
}
