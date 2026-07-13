// Telegram channel webhook — the first external messaging surface for the PA.
//
//   POST /api/hermes/channels/telegram
//   body: a Telegram Update (JSON) delivered by Telegram's webhook.
//   → always 200 to Telegram on any handled/ignored update (so it stops
//     retrying); 404 when the channel flag is off; 401/503 on a bad/absent
//     webhook secret.
//
// Pipeline (see lib/hermes/channels/*):
//   1. HERMES_TELEGRAM_ENABLED off → 404 (do NOT reveal the surface exists).
//   2. verifyInbound — constant-time check of X-Telegram-Bot-Api-Secret-Token
//      against TELEGRAM_WEBHOOK_SECRET. Bad → 401 (503 if unconfigured).
//   3. parseInbound — non-message / text-less updates → 200 ok, no Brain call.
//   4. Allowlist — ONLY a chat id in TELEGRAM_ALLOWED_CHAT_IDS may reach the
//      Brain. Anyone else gets a polite "not authorized" reply and is NEVER
//      routed to the Brain (fail-closed: empty allowlist authorises nobody).
//   5. Route text → runPaTurn (persona 'pa', the same operator PA the console
//      drives) → send the reply back. A gated tool the Brain wants stays gated:
//      we persist it as an action proposal (exactly like the web/Discord routes)
//      and reply "queued for approval" rather than executing it here.
//
// This surface is the SINGLE-USER PA: the allowlisted user is mapped to the PA
// persona/operator context the Brain already expects — no new privilege path.
//
// Public route (no Clerk session) — authenticated in-handler by the webhook
// secret, like /api/bot/* and /api/ingest/*. Registered in middleware.ts.
import { NextResponse } from 'next/server';
import { getRuntimeFlag } from '@/lib/hermes/runtime-flags';
import { runPaTurn, type PaTurnResult } from '@/lib/hermes/brain/graph';
import { saveActionProposal } from '@/lib/hermes/proposals';
import { appendAudit } from '@/lib/hermes/audit';
import { telegramAdapter } from '@/lib/hermes/channels/telegram';

export const dynamic = 'force-dynamic';

// 200 with a tiny body — the shape Telegram is happy with. Used for BOTH handled
// and deliberately-ignored updates so Telegram never retry-storms us.
function ok() {
  return NextResponse.json({ ok: true });
}

// Parse the comma-separated allowlist into a set of trimmed, non-empty chat ids.
// Fail-closed: an unset/empty env var yields an empty set → nobody is authorised.
function allowedChatIds(): Set<string> {
  return new Set(
    (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Turn a PA turn result into the plain text we send back to Telegram. A gated
// action is already persisted as a proposal by the caller; here we just phrase
// the "queued for approval" note (with the console proposal ref when we have it).
function replyFor(result: PaTurnResult, proposalId: string | null): string {
  switch (result.status) {
    case 'answered':
      return result.reply || 'Done.';
    case 'pending_approval': {
      const lead = result.reply ? `${result.reply}\n\n` : '';
      const ref = proposalId ? ` (ref ${proposalId})` : '';
      return `${lead}That action needs your approval before it runs${ref}. I've queued it in the Sentinel console — approve it there and I'll carry on.`;
    }
    case 'disabled':
      return 'The assistant is not enabled right now. Please try again later.';
    case 'error':
    default:
      return 'Sorry — something went wrong handling that. Please try again.';
  }
}

export async function POST(req: Request) {
  // 1. Flag gate — off → 404, do not reveal the surface.
  if (!(await getRuntimeFlag('HERMES_TELEGRAM_ENABLED'))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // 2. Authenticate the webhook (constant-time secret compare).
  const verified = await telegramAdapter.verifyInbound(req);
  if (!verified.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: verified.status });
  }

  // 3. Parse the update. Non-message / text-less → ack 200 so Telegram stops.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ok();
  }
  const inbound = telegramAdapter.parseInbound(body);
  if (!inbound) return ok();

  // 4. Allowlist — the ONLY gate to the Brain on this single-user surface.
  if (!allowedChatIds().has(inbound.chatId)) {
    // Polite refusal; never route an un-allowlisted sender to the Brain.
    try {
      await telegramAdapter.sendReply(
        inbound.chatId,
        'Sorry, this assistant is private and you are not authorized to use it.',
      );
    } catch {
      /* best-effort; still ack 200 */
    }
    return ok();
  }

  // 5. Route to the Brain. Map the allowlisted user onto the SAME PA context the
  // console operator has (persona 'pa'); the actor label is namespaced so audit
  // can tell Telegram-origin turns apart. thread = telegram:<chatId> → each chat
  // is its own persistent conversation.
  const threadId = `telegram:${inbound.chatId}`;
  const actor = `telegram:${inbound.userId}`;

  try {
    const result = await runPaTurn({ threadId, message: inbound.text, persona: 'pa', actor });

    // A gated tool → persist as an action proposal (shows in the Approvals queue),
    // exactly like /api/hermes/pa/chat and /api/bot/pa/chat. Never execute here.
    let proposalId: string | null = null;
    if (result.status === 'pending_approval') {
      const ref =
        typeof result.pending.args?.ref === 'string'
          ? (result.pending.args.ref as string)
          : threadId;
      proposalId = await saveActionProposal({
        ref,
        agent: 'pa',
        title: result.pending.describe || `PA action: ${result.pending.tool}`,
        summary: result.pending.describe || result.pending.tool,
        tool: result.pending.tool,
        args: result.pending.args,
        threadId,
        callId: result.pending.callId,
        persona: 'pa',
        describe: result.pending.describe,
      });
    }

    // Audit the inbound turn (immutable, hash-chained). We record the outcome
    // status + thread ref + actor — NOT the message text (kept out of the log).
    await appendAudit({
      actor,
      action: 'channel.telegram.message',
      tenantRef: threadId,
      summary: `telegram inbound → ${result.status}`,
      detail: {
        channel: 'telegram',
        chatId: inbound.chatId,
        userId: inbound.userId,
        status: result.status,
        textLen: inbound.text.length,
        ...(proposalId ? { proposalId } : {}),
      },
    });

    await telegramAdapter.sendReply(inbound.chatId, replyFor(result, proposalId));
    return ok();
  } catch (err) {
    // Log server-side; reply generically; STILL 200 so Telegram doesn't retry.
    console.error('[telegram] handler error', err);
    try {
      await telegramAdapter.sendReply(
        inbound.chatId,
        'Sorry — something went wrong handling that. Please try again.',
      );
    } catch {
      /* best-effort */
    }
    return ok();
  }
}
