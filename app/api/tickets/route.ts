// Ticket write API — create (POST). Operator-facing; gated by requireOpsAuth()
// (Clerk global_admin). The estate-app report-issue path is SEPARATE and lives
// at /api/ingest/issue (token/HMAC, no Clerk).
//
//   POST /api/tickets
//   body: { kind, title, description?, app?, impact?, urgency?, priority?,
//           status?, source?, slaDue?, attrs? }
//   → 201 { ok: true, ref }

import { requireOpsAuth } from '@/lib/auth';
import { createTicket, type CreateTicketInput } from '@/lib/data';
import type { TicketKind } from '@/lib/mock';

export const dynamic = 'force-dynamic';

const KINDS: TicketKind[] = ['incident', 'request', 'change', 'problem', 'release'];

export async function POST(req: Request) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const kind = body?.kind;
  if (!KINDS.includes(kind)) {
    return Response.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 });
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }

  const input: CreateTicketInput = {
    kind,
    title,
    description: typeof body.description === 'string' ? body.description : undefined,
    app: typeof body.app === 'string' ? body.app : undefined,
    impact: typeof body.impact === 'string' ? body.impact : undefined,
    urgency: typeof body.urgency === 'string' ? body.urgency : undefined,
    priority: typeof body.priority === 'string' ? body.priority : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    source: typeof body.source === 'string' ? body.source : undefined,
    slaDue: typeof body.slaDue === 'string' ? body.slaDue : undefined,
    attrs: body.attrs && typeof body.attrs === 'object' ? body.attrs : undefined,
  };

  try {
    const { ref } = await createTicket(input);
    // Fire-and-forget autonomous triage: auto-draft a Hermes proposal so the
    // approval queue populates without a human opening the ticket. Dynamic
    // import keeps the hermes deps off the hot path; the .catch guarantees it
    // can never affect this response. Deliberately NOT awaited.
    void import('@/lib/hermes/auto-triage')
      .then((m) => m.autoTriage(ref, input.kind))
      .catch(() => {});
    return Response.json({ ok: true, ref }, { status: 201 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'create failed' }, { status: 500 });
  }
}
