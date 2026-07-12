// Approve a proposal → RESUME the paused Brain graph and EXECUTE the gated tool
// for real (the #1 gap this P0 closes). For a plain copilot DRAFT proposal this
// still posts the draft to the ticket (legacy behaviour) — both handled by
// actOnProposal('approve').
//
//   POST /api/hermes/proposals/:id/approve
//   → 200 { ok, error? }
//
// Gated by the 'support' section. decided_by is recorded for audit.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { actOnProposal, getHermesProposal } from '@/lib/hermes/proposals';
import { isPrivilegedProposalKind, canApproveAtGate } from '@/lib/support/roles';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  const { id } = await params;
  const { userId, role } = await getSessionAccess();
  const actor = userId ?? 'operator';

  // P3 human gate — a privileged (money/account) proposal can ONLY be approved
  // by the human gate (global_admin), even though the whole support section can
  // reach the approval queue. This is what forces refunds/credits/account
  // changes through Ben, with no bypass by a support agent or lead.
  const rec = await getHermesProposal(id);
  if (rec && isPrivilegedProposalKind(rec.kind) && !canApproveAtGate(role)) {
    return NextResponse.json(
      { ok: false, error: 'Only a global admin can approve refunds, credits, or account changes.' },
      { status: 403 },
    );
  }

  const result = await actOnProposal(id, 'approve', actor);
  return NextResponse.json(result);
}
