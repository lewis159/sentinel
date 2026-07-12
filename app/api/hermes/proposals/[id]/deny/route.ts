// Deny a proposal → RESUME the paused Brain graph with a rejection so the agent
// can tell the principal it was declined, then mark the proposal dismissed. For a
// plain copilot DRAFT proposal this just dismisses it. Both handled by
// actOnProposal('dismiss').
//
//   POST /api/hermes/proposals/:id/deny
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

  const result = await actOnProposal(id, 'dismiss', actor);
  return NextResponse.json(result);
}
