// Exec on-demand invoke — the front door to the Brain for the EXEC personas
// (ceo / cto / risk), the sibling of the PA chat + copilot action routes.
//
//   POST /api/hermes/exec/chat
//   body: { persona: 'ceo' | 'cto' | 'risk'; threadId: string; message: string }
//   → 200 { status, reply?, pending?, proposalId?, error? }
//
// Runs one exec turn on the SHARED Brain graph (LangGraph, thread=threadId) via
// runPaTurn({ persona, ... }) — the exact spine the PA and the copilots use. CEO
// and Risk are read-only, so their turns always resolve to an 'answered' reply.
// The CTO is the one exec that carries GATED levers (triggerWorkflow / commitFile):
// when it calls one the graph PAUSES; we persist the pending tool call as an action
// PROPOSAL (so it shows in the Sentinel ApprovalsQueue exactly like a PA/copilot
// action) and return a 'pending_approval' marker. Approving that proposal resumes
// the graph and executes the tool for real, once.
//
// Risk is ADVISORY-ONLY: its allowedTools contain no executable tool, so the graph
// never offers it a gated tool and it can never reach the pending_approval branch.
// We assert that invariant defensively below (an exec flagged advisory must never
// produce a gated action) rather than relying on it implicitly.
//
// Behind HERMES_BRAIN_ENABLED — returns { status:'disabled' } when off, so the
// existing app is unaffected. Gated per-persona by the section that exec belongs
// to (EXEC_ROSTER[persona].section).
import { NextResponse } from 'next/server';
import { requireSectionApi, getSessionAccess } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { runPaTurn } from '@/lib/hermes/brain/graph';
import { getPersona } from '@/lib/hermes/brain/personas';
import { saveActionProposal } from '@/lib/hermes/proposals';
import { EXEC_ROSTER, isExecPersonaId, type ExecPersonaId } from '@/lib/hermes/agent-meta';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let persona: ExecPersonaId | null = null;
  let threadId = '';
  let message = '';
  try {
    const body: any = await req.json();
    if (isExecPersonaId(body?.persona)) persona = body.persona;
    threadId = typeof body?.threadId === 'string' ? body.threadId.trim() : '';
    message = typeof body?.message === 'string' ? body.message.trim() : '';
  } catch {
    /* fallthrough to validation */
  }

  // Reject a non-exec persona (e.g. a copilot id or garbage) up front — before any
  // section lookup or Brain work. The exec route is ONLY for ceo / cto / risk.
  if (!persona) {
    return NextResponse.json(
      { status: 'error', error: 'persona must be one of: ceo, cto, risk' },
      { status: 200 },
    );
  }

  // Gate by the section the chosen exec belongs to (from EXEC_ROSTER).
  const denied = await requireSectionApi(EXEC_ROSTER[persona].section);
  if (denied) return denied;

  if (!brainEnabled()) {
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

  const result = await runPaTurn({ threadId, message, persona, actor });

  if (result.status === 'pending_approval') {
    // Advisory-only execs (Risk) must NEVER produce a gated action — their tool
    // set is side-effect-free, so the graph can't interrupt for approval. If one
    // somehow did, refuse to raise a proposal (belt-and-braces on the contract).
    if (EXEC_ROSTER[persona].advisory || getPersona(persona)?.advisory) {
      return NextResponse.json(
        {
          status: 'error',
          error: `advisory-only exec "${persona}" cannot produce a gated action`,
        },
        { status: 200 },
      );
    }

    // Persist the paused tool call as an action proposal → shows in ApprovalsQueue.
    const ref =
      typeof result.pending.args?.ref === 'string'
        ? (result.pending.args.ref as string)
        : threadId;
    const proposalId = await saveActionProposal({
      ref,
      agent: persona,
      title: result.pending.describe || `${EXEC_ROSTER[persona].label}: ${result.pending.tool}`,
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
