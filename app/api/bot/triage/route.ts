// Bot Hermes triage — run a department agent over a ticket on demand.
//
// Token-gated (BOT tier). Same dispatch as the Clerk-gated /api/hermes/triage, but
// without the per-section Clerk gate (the bot token is the gate). Persists the
// resulting proposal to ops.hermes_proposals so it feeds the approval queue.
// Copilot-first: this only DRAFTS — a human still approves via a button.
//
//   POST /api/bot/triage
//   body: { ref, agent? }   (agent default 'support')
//   → 200 { ...HermesProposal, id }

import { getServiceTicket, getOneTicket } from '@/lib/data';
import { runCopilotProposal } from '@/lib/hermes/brain/copilot';
import { saveProposal } from '@/lib/hermes/proposals';
import { AGENT_META, type AgentKey } from '@/lib/hermes/agent-meta';
import { authBot, botJson, botOptions } from '@/lib/bot-http';

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

export async function OPTIONS() {
  return botOptions();
}

export async function POST(req: Request) {
  const auth = await authBot(req);
  if (!auth.ok) return auth.res;

  let ref = '';
  let agent: AgentKey = 'support';
  try {
    const body: any = JSON.parse(auth.raw);
    ref = typeof body?.ref === 'string' ? body.ref.trim() : '';
    if (isAgentKey(body?.agent)) agent = body.agent;
  } catch {
    ref = '';
  }

  const configured = Boolean(process.env.OPENROUTER_API_KEY);
  if (!ref) {
    return botJson({ ok: false, configured, error: 'ref is required' }, 200);
  }

  try {
    // Load the ticket (ITIL first, then basic), else a minimal stub.
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

    // Route through the shared Brain by persona (agent id == copilot persona id).
    const proposal = await runCopilotProposal({ persona: agent, input: agentInput });

    let id: string | null = null;
    if (proposal.ok) {
      id = await saveProposal({
        ref,
        agent,
        kind: agent,
        title,
        summary: proposal.classification ?? AGENT_META[agent].header,
        proposal,
      });
    }

    return botJson({ ...proposal, id });
  } catch (e: any) {
    return botJson({ ok: false, configured, error: e?.message ?? 'hermes triage failed' }, 200);
  }
}
