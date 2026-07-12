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
import { actOnProposal } from '@/lib/hermes/proposals';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  const { id } = await params;
  const { userId } = await getSessionAccess();
  const actor = userId ?? 'operator';

  const result = await actOnProposal(id, 'approve', actor);
  return NextResponse.json(result);
}
