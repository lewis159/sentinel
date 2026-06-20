// Roadmap write API — create (POST). Operator-facing; gated by requireOpsAuth()
// (Clerk global_admin). This is the IN-APP CRUD path for the editable roadmap
// board and is SEPARATE from /api/ingest/roadmap (token/HMAC, for agents/CI).
//
//   POST /api/roadmap
//   body: { title (required), description?, status?, app?, sort_order?, item_key? }
//   → 201 { ok: true, item }
//
// Auth: Clerk-gated. Not in middleware's public matcher, so middleware also
// requires a signed-in session; requireOpsAuth() additionally enforces global_admin.

import { requireOpsAuth } from '@/lib/auth';
import {
  createRoadmapItem, ROADMAP_APPS, type RoadmapCreateInput,
} from '@/lib/data';
import { ROADMAP_STATUSES } from '@/lib/mock';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }
  if (body?.status !== undefined && !ROADMAP_STATUSES.includes(body.status)) {
    return Response.json({ error: `status must be one of ${ROADMAP_STATUSES.join(', ')}` }, { status: 400 });
  }
  if (body?.app !== undefined && !ROADMAP_APPS.includes(body.app)) {
    return Response.json({ error: `app must be one of ${ROADMAP_APPS.join(', ')}` }, { status: 400 });
  }

  const input: RoadmapCreateInput = {
    item_key: typeof body.item_key === 'string' ? body.item_key : undefined,
    title,
    description: typeof body.description === 'string' ? body.description : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    app: typeof body.app === 'string' ? body.app : undefined,
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : undefined,
  };

  try {
    const { row } = await createRoadmapItem(input);
    if (!row) return Response.json({ ok: false, error: 'create failed' }, { status: 500 });
    return Response.json({ ok: true, item: row }, { status: 201 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'create failed' }, { status: 500 });
  }
}
