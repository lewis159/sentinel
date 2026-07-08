// Act on a Hermes proposal from the approval queue.
//
//   POST /api/hermes/proposals/:id
//   body: { action: 'approve' | 'dismiss' | 'mark-sent' }
//   → 200 { ok: boolean, error?: string }
//
// Gated by the 'support' section. `ok:false` surfaces the no-DB / error message.

import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { actOnProposal } from '@/lib/hermes/proposals';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  const { id } = await params;

  let action: string | undefined;
  try {
    const body: any = await req.json();
    action = typeof body?.action === 'string' ? body.action : undefined;
  } catch {
    action = undefined;
  }

  if (action !== 'approve' && action !== 'dismiss' && action !== 'mark-sent') {
    return NextResponse.json(
      { ok: false, error: 'action must be approve, dismiss or mark-sent' },
      { status: 200 },
    );
  }

  const { userId } = await getSessionAccess();
  const actor = userId ?? 'operator';

  const result = await actOnProposal(id, action, actor);
  return NextResponse.json(result);
}
