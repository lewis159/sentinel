// Hermes proposals API — the approval queue feed.
//
//   GET /api/hermes/proposals?status=pending
//   → 200 { proposals: HermesProposalRecord[], live: boolean }
//
// Gated by the 'support' section. `live` is false with no DB (queue empty).

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { hasDb } from '@/lib/db';
import { listProposals } from '@/lib/hermes/proposals';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';

  return NextResponse.json({
    proposals: await listProposals({ status }),
    live: hasDb,
  });
}
