// Hermes triage API — given a ticket ref and an agent, ask the chosen Hermes
// copilot to reason over the ticket and return a structured HermesProposal.
// Copilot-first: this only drafts / assesses, a human decides and acts.
//
//   POST /api/hermes/triage
//   body: { ref: string; agent?: AgentKey }   (default 'support')
//   → 200 HermesProposal  (always 200 so the client renders the state)
//
// Dispatches by agent (see AGENT_META for the section each is gated by):
//   - 'support'    → draftSupportReply   (support)
//   - 'incident'   → assessIncident      (operations)
//   - 'escalation' → draftEscalation     (support)
//   - 'billing'    → assessBilling       (support)
//   - 'security'   → assessSecurity      (security)
// Degrades gracefully with no DB (mock tickets) and no OPENROUTER_API_KEY
// (configured:false).

import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { getServiceTicket, getOneTicket } from '@/lib/data';
import { runCopilotProposal } from '@/lib/hermes/brain/copilot';
import { saveProposal } from '@/lib/hermes/proposals';
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
  let ref = '';
  let agent: AgentKey = 'support';
  try {
    const body: any = await req.json();
    ref = typeof body?.ref === 'string' ? body.ref.trim() : '';
    if (isAgentKey(body?.agent)) agent = body.agent;
  } catch {
    ref = '';
  }

  const meta = AGENT_META[agent];

  // Gate by the section the chosen agent belongs to (from AGENT_META).
  const denied = await requireSectionApi(meta.section);
  if (denied) return denied;

  try {
    if (!ref) {
      return NextResponse.json(
        {
          ok: false,
          configured: Boolean(process.env.OPENROUTER_API_KEY),
          error: 'ref is required',
        },
        { status: 200 },
      );
    }

    // Load the ticket: try the ITIL service ticket first, fall back to the
    // simpler ops ticket. Both return { row, live }. If neither has a row,
    // proceed with a minimal stub so the agent can still respond.
    let title = ref;
    let description: string | undefined;
    let priority: string | undefined;
    let status: string | undefined;

    const svc = await getServiceTicket(ref);
    if (svc.row) {
      title = svc.row.title;
      description = svc.row.description;
      priority = svc.row.priority;
      status = svc.row.status;
    } else {
      const basic = await getOneTicket(ref);
      if (basic.row) {
        title = basic.row.title;
        priority = basic.row.priority;
        status = basic.row.status;
      }
    }

    const agentInput = { ref, title, description, priority, status };

    // Route through the shared Brain: `agent` is also the copilot persona id
    // (support/incident/escalation/billing/security). Returns a HermesProposal.
    const proposal = await runCopilotProposal({ persona: agent, input: agentInput });

    // On a successful proposal, persist it so it feeds the approval queue.
    // Returns null in dev (no DB) — the queue is simply empty there.
    let id: string | null = null;
    if (proposal.ok) {
      id = await saveProposal({
        ref,
        agent,
        kind: agent,
        title,
        summary: proposal.classification ?? meta.header,
        proposal,
      });
    }

    return NextResponse.json({ ...proposal, id });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        configured: Boolean(process.env.OPENROUTER_API_KEY),
        error: e?.message ?? 'hermes triage failed',
      },
      { status: 200 },
    );
  }
}
