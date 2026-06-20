// Roadmap write API — update (PATCH) + delete (DELETE) by item_key. Operator-
// facing; gated by requireOpsAuth() (Clerk global_admin). In-app CRUD path for the
// editable roadmap board — SEPARATE from /api/ingest/roadmap (token/HMAC).
//
//   PATCH  /api/roadmap/RM-001
//     body: { title?, description?, status?, app?, sort_order? }
//     → 200 { ok: true, item }
//
//   DELETE /api/roadmap/RM-001
//     → 200 { ok: true }

import { requireOpsAuth } from '@/lib/auth';
import {
  updateRoadmapItem, deleteRoadmapItem, ROADMAP_APPS, type RoadmapUpdateInput,
} from '@/lib/data';
import { ROADMAP_STATUSES } from '@/lib/mock';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { key } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (body?.status !== undefined && !ROADMAP_STATUSES.includes(body.status)) {
    return Response.json({ error: `status must be one of ${ROADMAP_STATUSES.join(', ')}` }, { status: 400 });
  }
  if (body?.app !== undefined && !ROADMAP_APPS.includes(body.app)) {
    return Response.json({ error: `app must be one of ${ROADMAP_APPS.join(', ')}` }, { status: 400 });
  }

  const patch: RoadmapUpdateInput = {
    title: typeof body?.title === 'string' ? body.title : undefined,
    description: typeof body?.description === 'string' ? body.description : undefined,
    status: typeof body?.status === 'string' ? body.status : undefined,
    app: typeof body?.app === 'string' ? body.app : undefined,
    sort_order: typeof body?.sort_order === 'number' ? body.sort_order : undefined,
  };

  try {
    const { row } = await updateRoadmapItem(key, patch);
    if (!row) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, item: row });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'update failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { key } = await params;

  try {
    const ok = await deleteRoadmapItem(key);
    if (!ok) return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'delete failed' }, { status: 500 });
  }
}
