// Ticket activity API — the updates/comments timeline for one ITIL record.
// Operator-facing; both verbs gated by requireOpsAuth().
//
//   GET  /api/tickets/INC-0001/comments  → { ok, comments: [{ id, author, kind, body, createdAt }] }
//   POST /api/tickets/INC-0001/comments  body { body, kind? }  → 201 { ok, comment }
//
// The author label is resolved from the current Clerk user (name → username →
// id). It is stored in ops.comments.metadata->>'author'; author_user_id stays
// null (that column is a uuid and Clerk ids are text). Agent/system writes go
// through the public token-gated /api/ingest/update route instead.

import { auth, currentUser } from '@clerk/nextjs/server';
import { requireOpsAuth } from '@/lib/auth';
import { getTicketComments, addTicketComment } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { ref } = await params;
  try {
    const comments = await getTicketComments(ref);
    return Response.json({ ok: true, comments });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'failed' }, { status: 500 });
  }
}

// Resolve a human-friendly author label from the Clerk session.
async function authorLabel(): Promise<string> {
  try {
    const u = await currentUser();
    if (u) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      if (name) return name;
      if (u.username) return u.username;
      const email = u.emailAddresses?.[0]?.emailAddress;
      if (email) return email;
      return u.id;
    }
  } catch {
    /* fall through to session id */
  }
  const { userId } = await auth();
  return userId ?? 'Operator';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const denied = await requireOpsAuth();
  if (denied) return denied;

  const { ref } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) {
    return Response.json({ error: 'body is required' }, { status: 400 });
  }
  const kind = typeof body?.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'update';

  try {
    const author = await authorLabel();
    const comment = await addTicketComment(ref, text, author, kind);
    if (!comment) return Response.json({ ok: false, error: 'ticket not found' }, { status: 404 });
    return Response.json({ ok: true, comment }, { status: 201 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'post failed' }, { status: 500 });
  }
}
