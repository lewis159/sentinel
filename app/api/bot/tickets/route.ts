// Bot ticket create — the Discord `/ticket` command lands here.
//
// Token-gated (BOT tier, OPS_BOT_TOKEN — token or HMAC), NOT Clerk. Mirrors the
// validation of the Clerk-gated /api/tickets POST and calls the SAME createTicket()
// + fire-and-forget autoTriage, so a bot-created ticket auto-drafts a Hermes
// proposal exactly like the web path.
//
//   POST /api/bot/tickets
//   body: { kind, title, description?, app?, impact?, urgency?, priority?,
//           status?, source?, slaDue?, attrs? }
//   → 201 { ok: true, ref }

import { createTicket, type CreateTicketInput } from '@/lib/data';
import type { TicketKind } from '@/lib/mock';
import { authBot, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

const KINDS: TicketKind[] = ['incident', 'request', 'change', 'problem', 'release'];

export async function OPTIONS() {
  return botOptions();
}

export async function POST(req: Request) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  let body: any;
  try {
    body = JSON.parse(auth.raw);
  } catch {
    return botJson({ error: 'invalid JSON body' }, 400);
  }

  const kind = body?.kind;
  if (!KINDS.includes(kind)) {
    return botJson({ error: `kind must be one of ${KINDS.join(', ')}` }, 400);
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return botJson({ error: 'title is required' }, 400);
  }

  const input: CreateTicketInput = {
    kind,
    title,
    description: typeof body.description === 'string' ? body.description : undefined,
    app: typeof body.app === 'string' ? body.app : 'Discord',
    impact: typeof body.impact === 'string' ? body.impact : undefined,
    urgency: typeof body.urgency === 'string' ? body.urgency : undefined,
    priority: typeof body.priority === 'string' ? body.priority : undefined,
    status: typeof body.status === 'string' ? body.status : undefined,
    source: typeof body.source === 'string' ? body.source : 'discord',
    slaDue: typeof body.slaDue === 'string' ? body.slaDue : undefined,
    attrs: body.attrs && typeof body.attrs === 'object' ? body.attrs : undefined,
  };

  try {
    const { ref } = await createTicket(input);
    // Fire-and-forget autonomous triage — identical to /api/tickets. Deliberately
    // not awaited; the .catch guarantees it can never affect this response.
    void import('@/lib/hermes/auto-triage')
      .then((m) => m.autoTriage(ref, input.kind))
      .catch(() => {});
    return botJson({ ok: true, ref }, 201);
  } catch (e: any) {
    return botJson({ ok: false, error: e?.message ?? 'create failed' }, 500);
  }
}
