import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireOpsAuth } from '@/lib/auth';
import { requestQuotaIncrease } from '@/lib/access';
import { getApp } from '@/lib/apps';

export const dynamic = 'force-dynamic';

// POST /api/users/[id]/quota-request  { app, currentLimit?, requestedLimit, reason, targetUserLabel }
// For metered estate apps (e.g. YT): creates a service-request ticket in the
// ITIL module and links it back to the user via the access audit. global_admin only.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { id } = await params;
  const { userId: actorId } = await auth();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const app = String(body?.app ?? '');
  const def = getApp(app);
  if (!def) return NextResponse.json({ error: `unknown app: ${app}` }, { status: 400 });
  if (!def.metered) return NextResponse.json({ error: `${def.name} is not metered` }, { status: 400 });

  const requestedLimit = String(body?.requestedLimit ?? '').trim();
  const reason = String(body?.reason ?? '').trim();
  if (!requestedLimit) return NextResponse.json({ error: 'requestedLimit is required' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });

  try {
    const { ref } = await requestQuotaIncrease({
      clerkUserId: id,
      targetUserLabel: String(body?.targetUserLabel ?? id),
      app,
      currentLimit: body?.currentLimit ? String(body.currentLimit) : undefined,
      requestedLimit,
      reason,
      actor: actorId ?? 'unknown',
    });
    return NextResponse.json({ ok: true, ref });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}
