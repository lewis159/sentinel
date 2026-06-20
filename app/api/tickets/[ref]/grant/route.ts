import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireOpsAuth } from '@/lib/auth';
import { grantOnApproval } from '@/lib/access';

export const dynamic = 'force-dynamic';

// POST /api/tickets/[ref]/grant
// Applies the access grant described by an approved request ticket. For
// ops-owned apps (Sentinel/Bruce) it writes the grant; for YT it records intent
// only (YT owns tier/credits — apply via the YT admin API in Phase 2).
// global_admin only.
export async function POST(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { ref } = await params;
  const { userId: actorId } = await auth();

  try {
    const result = await grantOnApproval(ref, actorId ?? 'unknown');
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}
