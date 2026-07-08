// Bot ticket comment append — two-way ticket updates from a Discord thread.
//
// Token-gated (BOT tier). Functionally the same as /api/ingest/update, but part of
// the single-token /api/bot surface and it attributes the author to the Discord
// user (namespaced `discord:<user>` for audit) rather than defaulting to 'Claude'.
//
// GUARDRAIL: this posts an INTERNAL update (kind='update'). Customer-facing replies
// are NEVER auto-sent here — they always route through a Hermes proposal that a
// human approves (POST /api/bot/proposals/:id {action:'approve'}).
//
//   POST /api/bot/tickets/:ref/comments
//   body: { body, author?, kind? }
//   → 201 { ok: true, comment }

import { addTicketComment } from '@/lib/data';
import { authBot, botActor, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return botOptions();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  const { ref } = await params;

  let body: any;
  try {
    body = JSON.parse(auth.raw);
  } catch {
    return botJson({ error: 'invalid JSON body' }, 400);
  }

  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return botJson({ error: 'body is required' }, 400);

  // Only allow internal update kinds from the bot. A customer-facing 'reply' must
  // go through the Hermes approve flow, so we never honour it here.
  const kind = body?.kind === 'note' ? 'note' : 'update';
  const author = botActor(body?.author);

  try {
    const comment = await addTicketComment(ref, text, author, kind);
    if (!comment) return botJson({ ok: false, error: `ticket ${ref} not found` }, 404);
    return botJson({ ok: true, comment }, 201);
  } catch (e: any) {
    return botJson({ ok: false, error: e?.message ?? 'comment failed' }, 500);
  }
}
