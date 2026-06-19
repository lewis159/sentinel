// Per-user dashboard layout API. Both verbs gated by requireOpsAuth(); the
// current user is resolved from the Clerk session. DB-first — when there's no
// DATABASE_URL the GET returns null and the PUT no-ops gracefully, so the UI
// still works off its default layout + localStorage cache.
//
//   GET /api/layouts/ticket-detail            → { ok, layout: <json> | null }
//   PUT /api/layouts/ticket-detail  body json → { ok, saved: boolean }

import { auth } from '@clerk/nextjs/server';
import { requireOpsAuth } from '@/lib/auth';
import { getUserLayout, saveUserLayout } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { key } = await params;
  const { userId } = await auth();
  if (!userId) return Response.json({ ok: false, error: 'no user' }, { status: 401 });

  try {
    const layout = await getUserLayout(userId, key);
    return Response.json({ ok: true, layout });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'failed' }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { key } = await params;
  const { userId } = await auth();
  if (!userId) return Response.json({ ok: false, error: 'no user' }, { status: 401 });

  let layout: any;
  try {
    layout = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  if (layout === null || typeof layout !== 'object') {
    return Response.json({ ok: false, error: 'layout must be an object' }, { status: 400 });
  }

  try {
    const saved = await saveUserLayout(userId, key, layout);
    return Response.json({ ok: true, saved });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'save failed' }, { status: 500 });
  }
}
