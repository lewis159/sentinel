import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireOpsAuth } from '@/lib/auth';
import { setUserAccess } from '@/lib/access';
import { isValidApp, isValidLevel } from '@/lib/apps';

export const dynamic = 'force-dynamic';

// PATCH /api/users/[id]/access  { app, level }
// Sets a user's access level for one estate app: DB upsert (source of truth) →
// Clerk publicMetadata.apps mirror → append-only audit row. global_admin only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const level = String(body?.level ?? '');
  if (!isValidApp(app)) return NextResponse.json({ error: `unknown app: ${app}` }, { status: 400 });
  if (!isValidLevel(level)) return NextResponse.json({ error: `invalid level: ${level}` }, { status: 400 });

  try {
    const result = await setUserAccess(id, app, level, actorId ?? 'unknown');
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'failed' }, { status: 500 });
  }
}
