// Generic manual link API — creates an edge in ops.links between any two nodes
// in the graph vocab. Gated by requireOpsAuth(). Powers the "Link…" picker in
// LinksPanel for the manual relations (KB→finding, ticket→ticket related, …).
// The auto spine (finding→component, ticket→finding, component→container) is
// written by the ingest / topology paths, not here.
//
//   POST /api/links { srcType, srcId, dstType, dstId, relation? } → { ok }
//
// Both ends are validated to exist (for DB-backed types) by lib/data.createLink,
// which also enforces the node-type + relation vocab and rejects self-loops. The
// edge is tagged created_by = the Clerk user label so auto-reconcile never
// clobbers it.

import { auth, clerkClient } from '@clerk/nextjs/server';
import { requireOpsAuth } from '@/lib/auth';
import { createLink } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Resolve a human label for the current Clerk user (falls back to the user id).
async function currentUserLabel(): Promise<string> {
  try {
    const { userId } = await auth();
    if (!userId) return 'manual';
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
    if (u.username) return u.username;
    const email = u.emailAddresses?.[0]?.emailAddress;
    if (email) return email;
    return u.id;
  } catch {
    const { userId } = await auth();
    return userId ?? 'manual';
  }
}

export async function POST(req: Request) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const srcType = typeof body?.srcType === 'string' ? body.srcType.trim() : '';
  const srcId = typeof body?.srcId === 'string' ? body.srcId.trim() : '';
  const dstType = typeof body?.dstType === 'string' ? body.dstType.trim() : '';
  const dstId = typeof body?.dstId === 'string' ? body.dstId.trim() : '';
  const relation = typeof body?.relation === 'string' ? body.relation.trim() : undefined;

  if (!srcType || !srcId || !dstType || !dstId) {
    return Response.json(
      { ok: false, error: 'srcType, srcId, dstType and dstId are required' },
      { status: 400 }
    );
  }

  try {
    const createdBy = await currentUserLabel();
    const result = await createLink({ srcType, srcId, dstType, dstId, relation, createdBy });
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error ?? 'link failed' }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'link failed' }, { status: 500 });
  }
}
