// Bot-facing PA chat — the Discord sibling of /api/hermes/pa/chat.
//
//   POST /api/bot/pa/chat
//   body: { channelId: string; message: string; author?: string }
//   → 200 { status, reply?, pending?, proposalId?, error? }
//
// Token-gated (BOT tier) with the SAME OPS_BOT_TOKEN / HMAC scheme as the other
// /api/bot/* routes (via authBot) — NOT Clerk. The Discord bot POSTs here when a
// message lands in the PA channel (or a DM / @mention); we run one PA turn on the
// Brain with thread id `discord:<channelId>` so each Discord channel is its own
// persistent conversation.
//
// When the model calls a GATED tool the graph pauses; we persist the pending tool
// call as an action PROPOSAL (identical to the Clerk route — so it surfaces in the
// Sentinel ApprovalsQueue AND is polled onto the Discord #approvals channel with
// Approve/Dismiss buttons). We return a `pending_approval` marker so the bot can
// reply "flagged for approval". Approving that proposal resumes the graph and runs
// the tool for real (see lib/hermes/proposals.ts → actOnProposal).
//
// Behind HERMES_BRAIN_ENABLED — returns { status:'disabled' } when off, so the
// existing bot surface is unaffected.
import { getRuntimeFlag } from '@/lib/hermes/runtime-flags';
import { runPaTurn } from '@/lib/hermes/brain/graph';
import { saveActionProposal } from '@/lib/hermes/proposals';
import { authBot, botActor, botJson, botOptions } from '@/lib/bot-http';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return botOptions();
}

export async function POST(req: Request) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  if (!(await getRuntimeFlag('HERMES_BRAIN_ENABLED'))) {
    return botJson({
      status: 'disabled',
      error: 'Hermes Brain is disabled — set HERMES_BRAIN_ENABLED=1 to enable.',
    });
  }

  let channelId = '';
  let message = '';
  let author: unknown;
  try {
    const body: any = JSON.parse(auth.raw || '{}');
    channelId = typeof body?.channelId === 'string' ? body.channelId.trim() : '';
    message = typeof body?.message === 'string' ? body.message.trim() : '';
    author = body?.author;
  } catch {
    /* fallthrough to validation */
  }
  if (!channelId || !message) {
    return botJson({ status: 'error', error: 'channelId and message are required' }, 200);
  }

  const threadId = `discord:${channelId}`;
  // Audit actor: namespaced Discord username (falls back to 'discord').
  const actor = botActor(author);

  const result = await runPaTurn({ threadId, message, persona: 'pa', actor });

  if (result.status === 'pending_approval') {
    // Persist the paused tool call as an action proposal → shows in the web
    // ApprovalsQueue AND is polled onto the Discord #approvals channel.
    const ref =
      typeof result.pending.args?.ref === 'string'
        ? (result.pending.args.ref as string)
        : threadId;
    const proposalId = await saveActionProposal({
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
    return botJson({
      status: 'pending_approval',
      reply: result.reply,
      pending: result.pending,
      proposalId,
    });
  }

  return botJson(result);
}
