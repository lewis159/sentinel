// P3 — escalate a support ticket up the ladder (L1 → L2 → human gate).
//
//   POST /api/tickets/:ref/escalate
//   body: { toLevel?: 'l1'|'l2'|'human', reason?: string, action?: SupportAction }
//   → 200 { ok, level }                  (plain escalation)
//   → 200 { ok, gated: true, proposalId } (money/account action → human gate)
//
// Gated by the `support` section. A money/account action (refund/credit/
// account_change) NEVER executes here: it is raised to the existing Hermes
// proposals human gate, which only a global_admin can approve. `escalate`
// itself is a front-line action any support role may take.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { escalateTicket, raiseHumanGateProposal } from '@/lib/support/data';
import {
  authorize,
  requiresHumanGate,
  toEscalationLevel,
  type SupportAction,
} from '@/lib/support/roles';

export const dynamic = 'force-dynamic';

const MONEY_ACTIONS: SupportAction[] = ['refund', 'credit', 'account_change'];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  const { role, userId } = await getSessionAccess();
  const actor = userId ?? 'operator';
  const { ref } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const reason = typeof body?.reason === 'string' ? body.reason : '';
  const action: SupportAction | undefined = MONEY_ACTIONS.includes(body?.action)
    ? body.action
    : undefined;

  // Money / account action → route to the HUMAN approval gate (no direct
  // execution, no bypass). Requires lead/admin authority even to raise it.
  if (action && requiresHumanGate(action)) {
    const decision = authorize(role, action);
    if (decision !== 'gate') {
      return NextResponse.json(
        { error: 'Forbidden — refunds/credits require a lead or admin' },
        { status: 403 },
      );
    }
    const proposalId = await raiseHumanGateProposal({
      ref,
      action,
      title: `${action} on ${ref}`,
      summary: reason || `${action} requested — awaiting human approval`,
      by: actor,
    });
    return NextResponse.json({ ok: true, gated: true, proposalId });
  }

  // Plain escalation up the ladder.
  if (authorize(role, 'escalate') !== 'allow') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const toLevel = body?.toLevel ? toEscalationLevel(body.toLevel) : undefined;
  const res = await escalateTicket(ref, toLevel, reason, actor);
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, level: res.level, id: res.id });
}
