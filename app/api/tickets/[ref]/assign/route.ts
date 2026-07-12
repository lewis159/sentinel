// P3 — assign a support ticket to a staff member.
//
//   POST /api/tickets/:ref/assign   body: { assignee }   ('' / '—' → unassign)
//   → 200 { ok: true, ticket }
//
// Gated by the `support` section (so support_agent / support_lead / global_admin
// reach it — not just global_admin) AND the finer support-action authorization
// (`assign` is a front-line action any support role may take).
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { assignTicket } from '@/lib/data';
import { authorize } from '@/lib/support/roles';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  const { role } = await getSessionAccess();
  if (authorize(role, 'assign') !== 'allow') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { ref } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const assignee = typeof body?.assignee === 'string' ? body.assignee : '';

  try {
    const { row } = await assignTicket(ref, assignee);
    if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, ticket: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'assign failed' }, { status: 500 });
  }
}
