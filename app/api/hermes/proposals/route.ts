// Hermes proposals API — the approval queue feed.
//
//   GET /api/hermes/proposals              → queue feed: PENDING first, then the
//                                            most recently-decided rows (read-only)
//   GET /api/hermes/proposals?status=pending → single-status filter (back-compat)
//   → 200 { proposals: HermesProposalRecord[], live: boolean }
//
// Gated by the 'support' section. `live` is false with no DB (queue empty).

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { hasDb } from '@/lib/db';
import { getHermesProposals, listProposals } from '@/lib/hermes/proposals';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  const url = new URL(req.url);
  // Explicit ?status=X → filter to that status. Otherwise serve the queue feed
  // (pending first, then recently-decided rows shown read-only in the UI).
  const status = url.searchParams.get('status');

  return NextResponse.json({
    proposals: status
      ? await listProposals({ status })
      : await getHermesProposals(),
    live: hasDb,
  });
}
