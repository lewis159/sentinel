// Autonomous triage — when a ticket is created, fire-and-forget draft a Hermes
// proposal so the approval queue populates WITHOUT a human first opening the
// ticket. Copilot-first is preserved: this only DRAFTS a proposal (status
// pending); a human still reviews/approves/dismisses from the queue.
//
// Opt-in and double-gated: it no-ops unless HERMES_AUTO_TRIAGE === 'true' AND a
// provider key is configured. It is fire-and-forget — EVERYTHING is wrapped so
// it can never throw into the ticket-create caller. Never logs secrets.
import 'server-only';
import { getHermesRuntimeConfig } from './config';
import { draftSupportReply } from './support-agent';
import { assessIncident } from './incident-agent';
import { saveProposal } from './proposals';
import { getServiceTicket, getOneTicket } from '@/lib/data';

/**
 * Auto-draft a Hermes proposal for a freshly created ticket.
 *
 * @param ref  the ticket ref (e.g. "INC-1024")
 * @param kind the ticket kind; 'incident' routes to the incident agent,
 *             anything else routes to the support agent.
 *
 * Fire-and-forget: NEVER throws. Callers should `void` this (and .catch()).
 */
export async function autoTriage(ref: string, kind?: string): Promise<void> {
  try {
    // Gate 1: autonomous triage must be explicitly opted in (default off).
    if (process.env.HERMES_AUTO_TRIAGE !== 'true') return;

    // Gate 2: a provider key must be configured, else there's nothing to run.
    const cfg = await getHermesRuntimeConfig();
    if (!cfg.hasKey) return;

    // Load the ticket for grounding. DB-first with a mock fallback, then a
    // minimal shape so we always have at least a title to work from.
    let ticket: {
      ref: string;
      title: string;
      description?: string;
      priority?: string;
      status?: string;
    };
    const svc = await getServiceTicket(ref);
    if (svc.row) {
      ticket = {
        ref: svc.row.ref,
        title: svc.row.title,
        description: svc.row.description,
        priority: svc.row.priority,
        status: svc.row.status,
      };
    } else {
      const one = await getOneTicket(ref);
      if (one.row) {
        ticket = {
          ref: one.row.ref,
          title: one.row.title,
          priority: one.row.priority,
          status: one.row.status,
        };
      } else {
        ticket = { ref, title: ref };
      }
    }

    // Pick the agent by kind. Incidents get the incident assessor; everything
    // else (request/change/problem/release) gets the support drafter.
    const agent = kind === 'incident' ? 'incident' : 'support';
    const proposal =
      agent === 'incident'
        ? await assessIncident(ticket)
        : await draftSupportReply(ticket);

    if (!proposal.ok) return;

    await saveProposal({
      ref: ticket.ref,
      agent,
      kind: agent,
      title: ticket.title,
      summary: proposal.classification ?? 'Auto-triaged proposal',
      proposal,
    });
  } catch {
    // Fire-and-forget: swallow everything. This must never affect ticket
    // creation. Do not log — avoid leaking any request/secret context.
  }
}
