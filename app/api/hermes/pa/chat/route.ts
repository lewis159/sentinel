// PA chat — the front door to the Brain (the PA persona).
//
//   POST /api/hermes/pa/chat
//   body: { threadId: string; message: string }
//   → 200 { status, reply?, pending?, proposalId?, error? }
//
// Runs one PA turn on the Brain (LangGraph, thread=threadId). Thread ids look
// like 'discord:<channelId>' or 'web:<id>'. When the model calls a GATED tool the
// graph pauses; we persist the pending tool call as an action PROPOSAL (so it
// shows in the Sentinel ApprovalsQueue) and return a 'pending_approval' marker.
// Approving that proposal resumes the graph and executes the tool for real.
//
// Behind HERMES_BRAIN_ENABLED — returns { status:'disabled' } when off, so the
// existing app is unaffected. Gated by the 'support' section, like the other
// /api/hermes/* routes.
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { getRuntimeFlag } from '@/lib/hermes/runtime-flags';
import { runPaTurn } from '@/lib/hermes/brain/graph';
import { saveActionProposal } from '@/lib/hermes/proposals';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const denied = await requireSectionApi('support');
  if (denied) return denied;

  if (!(await getRuntimeFlag('HERMES_BRAIN_ENABLED'))) {
    return NextResponse.json({
      status: 'disabled',
      error: 'Hermes Brain is disabled — set HERMES_BRAIN_ENABLED=1 to enable.',
    });
  }

  let threadId = '';
  let message = '';
  try {
    const body: any = await req.json();
    threadId = typeof body?.threadId === 'string' ? body.threadId.trim() : '';
    message = typeof body?.message === 'string' ? body.message.trim() : '';
  } catch {
    /* fallthrough to validation */
  }
  if (!threadId || !message) {
    return NextResponse.json(
      { status: 'error', error: 'threadId and message are required' },
      { status: 200 },
    );
  }

  const { userId } = await getSessionAccess();
  const actor = userId ? `web:${userId}` : threadId;

  const result = await runPaTurn({ threadId, message, persona: 'pa', actor });

  if (result.status === 'pending_approval') {
    // Persist the paused tool call as an action proposal → shows in ApprovalsQueue.
    const ref =
      typeof result.pending.args?.ref === 'string' ? (result.pending.args.ref as string) : threadId;
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
    return NextResponse.json({
      status: 'pending_approval',
      reply: result.reply,
      pending: result.pending,
      proposalId,
    });
  }

  return NextResponse.json(result);
}
