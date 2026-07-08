// Bot proposal action — the Approve/Dismiss buttons in Discord land here.
//
// Token-gated (BOT tier). Calls the SAME actOnProposal() as the web queue:
//   - approve  → posts the Hermes draft to the ticket as a reply, marks 'sent'
//   - dismiss  → marks 'dismissed'
//   - mark-sent→ marks 'sent' without posting (reply sent elsewhere, e.g. an edit)
// The actor is recorded as `discord:<user>` in decided_by for audit.
//
// This is the ONLY path by which a customer-facing draft leaves the buffer, and it
// still requires a human to click Approve — copilot-first, identical to the web app.
//
//   POST /api/bot/proposals/:id
//   body: { action: 'approve' | 'dismiss' | 'mark-sent', by? }
//   → 200 { ok: boolean, error? }

import { actOnProposal } from '@/lib/hermes/proposals';
import { authBot, botActor, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return botOptions();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  const { id } = await params;

  let action: string | undefined;
  let by: unknown;
  try {
    const body: any = JSON.parse(auth.raw || '{}');
    action = typeof body?.action === 'string' ? body.action : undefined;
    by = body?.by;
  } catch {
    action = undefined;
  }

  if (action !== 'approve' && action !== 'dismiss' && action !== 'mark-sent') {
    return botJson({ ok: false, error: 'action must be approve, dismiss or mark-sent' }, 200);
  }

  const result = await actOnProposal(id, action, botActor(by));
  return botJson(result);
}
