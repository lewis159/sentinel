// Copilot agentic action — the front door to the Brain for the FIVE department
// copilots (support/incident/escalation/billing/security), the sibling of the PA
// chat route.
//
//   POST /api/hermes/copilot/action
//   body: { persona: AgentKey; threadId: string; message: string }
//   → 200 { status, reply?, pending?, proposalId?, error? }
//
// Runs one copilot turn on the SHARED Brain graph (LangGraph, thread=threadId) via
// runCopilotAction → runPaTurn. When the model calls a GATED tool (e.g. Support ·
// updateTicket) the graph pauses; we persist the pending tool call as an action
// PROPOSAL (so it shows in the Sentinel ApprovalsQueue exactly like a PA action)
// and return a 'pending_approval' marker. Approving that proposal resumes the
// graph and executes the tool for real, once.
//
// Behind HERMES_BRAIN_ENABLED — returns { status:'disabled' } when off, so the
// existing app + the DRAFT copilot surface (/api/hermes/triage) are unaffected.
// Gated per-persona by the section that persona belongs to (AGENT_META.section).
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { getRuntimeFlag } from '@/lib/hermes/runtime-flags';
import { runCopilotAction } from '@/lib/hermes/brain/copilot';
import { saveActionProposal } from '@/lib/hermes/proposals';
import { AGENT_META, type AgentKey } from '@/lib/hermes/agent-meta';

export const dynamic = 'force-dynamic';

function isAgentKey(v: unknown): v is AgentKey {
  return (
    v === 'support' ||
    v === 'incident' ||
    v === 'escalation' ||
    v === 'billing' ||
    v === 'security'
  );
}

export async function POST(req: Request) {
  let persona: AgentKey = 'support';
  let threadId = '';
  let message = '';
  try {
    const body: any = await req.json();
    if (isAgentKey(body?.persona)) persona = body.persona;
    threadId = typeof body?.threadId === 'string' ? body.threadId.trim() : '';
    message = typeof body?.message === 'string' ? body.message.trim() : '';
  } catch {
    /* fallthrough to validation */
  }

  // Gate by the section the chosen copilot belongs to (from AGENT_META).
  const denied = await requireSectionApi(AGENT_META[persona].section);
  if (denied) return denied;

  if (!(await getRuntimeFlag('HERMES_BRAIN_ENABLED'))) {
    return NextResponse.json({
      status: 'disabled',
      error: 'Hermes Brain is disabled — set HERMES_BRAIN_ENABLED=1 to enable.',
    });
  }

  if (!threadId || !message) {
    return NextResponse.json(
      { status: 'error', error: 'threadId and message are required' },
      { status: 200 },
    );
  }

  const { userId } = await getSessionAccess();
  const actor = userId ? `web:${userId}` : `${persona}:${threadId}`;

  const result = await runCopilotAction({ persona, threadId, message, actor });

  if (result.status === 'pending_approval') {
    // Persist the paused tool call as an action proposal → shows in ApprovalsQueue.
    const ref =
      typeof result.pending.args?.ref === 'string'
        ? (result.pending.args.ref as string)
        : threadId;
    const proposalId = await saveActionProposal({
      ref,
      agent: persona,
      title: result.pending.describe || `${AGENT_META[persona].header}: ${result.pending.tool}`,
      summary: result.pending.describe || result.pending.tool,
      tool: result.pending.tool,
      args: result.pending.args,
      threadId,
      callId: result.pending.callId,
      persona,
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
