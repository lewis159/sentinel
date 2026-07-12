// Hermes · Incident Commander — STATUS DRAFT + gated broadcast.
//
// Turns an assembled IncidentContext into a stakeholder STATUS UPDATE:
//   what's affected · impact · what we're doing · ETA (if known).
//
// Two modes:
//   • DETERMINISTIC TEMPLATE (default, dormant-safe) — pure string assembly from
//     the assembled facts. No model call. This is what runs when the Brain is off.
//   • LLM NARRATIVE (brainEnabled()) — asks the model to phrase the SAME facts as
//     a crisp update. It is instructed to use ONLY the provided facts. Any failure
//     falls straight back to the template, so the surface never breaks.
//
// GATING — the external post is NEVER automatic:
//   queueStatusProposal() persists the draft as an `incident-status` proposal in
//   the approval queue (saveProposal). It DOES NOT broadcast. Only an explicit
//   operator approval (approveStatusBroadcast, invoked by the gated route) runs
//   the broadcastStatus tool and marks the proposal sent. Opening/annotating the
//   incident ticket is a separate operator action (see the route) — additive and
//   allowed; the external broadcast is the only thing behind the gate.
import 'server-only';

import { brainEnabled } from '@/lib/hermes/brain/flags';
import { saveProposal, actOnProposal } from '@/lib/hermes/proposals';
import { broadcastStatusTool } from '@/lib/hermes/brain/tools/broadcast';
import type { HermesProposal } from '@/lib/hermes/types';
import type { IncidentContext } from './context';

export type StatusDraft = {
  text: string;
  generatedBy: 'template' | 'llm';
  headline: string;
  affected: string;
  impact: string;
  action: string;
  eta: string;
  model?: string;
};

const SEV_WORD: Record<string, string> = {
  critical: 'Major outage',
  warning: 'Degraded service',
  info: 'Advisory',
  other: 'Investigating',
};

// ---- Deterministic field derivation --------------------------------------

function affectedLine(ctx: IncidentContext): string {
  const parts = new Set<string>();
  if (ctx.primaryService) parts.add(ctx.primaryService);
  for (const a of ctx.alerts) if (a.correlated && a.service) parts.add(a.service);
  for (const r of ctx.relatedTickets) if (r.app) parts.add(r.app);
  const list = [...parts].filter(Boolean);
  if (list.length === 0) return 'Estate services (scope under investigation)';
  return list.join(', ');
}

function impactLine(ctx: IncidentContext): string {
  switch (ctx.monitoringState.overall) {
    case 'down':
      return 'Service is currently unavailable or failing for affected users.';
    case 'degraded':
      return 'Users may see slow or partial functionality on affected services.';
    default:
      return 'No customer-facing impact has been confirmed yet; investigating as a precaution.';
  }
}

function actionLine(ctx: IncidentContext): string {
  const bits: string[] = [];
  // Point at a recent failed/in-flight deploy if one is visible.
  const badRun = ctx.recentDeploys.repos.find(
    (r) => r.latestRun && (r.latestRun.conclusion === 'failure' || r.latestRun.status !== 'completed'),
  );
  if (badRun && badRun.latestRun) {
    bits.push(`reviewing a recent deploy on ${badRun.repo} (${badRun.latestRun.branch})`);
  }
  const openChange = ctx.relatedTickets.find((r) => r.kind === 'change');
  if (openChange) bits.push(`checking related change ${openChange.ref}`);
  if (ctx.alerts.some((a) => a.correlated)) bits.push('correlating firing alerts with recent activity');
  if (bits.length === 0) return 'Engineers are actively investigating the root cause.';
  return `Engineers are ${bits.join(', ')}.`;
}

function etaLine(ctx: IncidentContext): string {
  // We do not invent an ETA. If the incident is not confirmed impacting, say so.
  if (ctx.monitoringState.overall === 'operational') {
    return 'No customer impact confirmed — next update if the situation changes.';
  }
  return 'ETA to resolution is not yet confirmed; the next update will follow shortly.';
}

// ---- Public: draft the status update -------------------------------------

export async function draftIncidentStatus(
  ctx: IncidentContext,
  opts?: { useBrain?: boolean },
): Promise<StatusDraft> {
  const sev = ctx.severity ?? 'other';
  const headline = `${SEV_WORD[sev] ?? 'Investigating'} — ${ctx.title}`;
  const affected = affectedLine(ctx);
  const impact = impactLine(ctx);
  const action = actionLine(ctx);
  const eta = etaLine(ctx);

  const templateText = [
    `**${headline}**`,
    ``,
    `**Affected:** ${affected}`,
    `**Impact:** ${impact}`,
    `**What we're doing:** ${action}`,
    `**ETA:** ${eta}`,
  ].join('\n');

  const wantBrain = opts?.useBrain ?? true;
  // Deterministic template path — the ONLY path when the Brain is off. No import
  // of the model client happens here, so a dormant deploy never reaches OpenRouter.
  if (!wantBrain || !brainEnabled()) {
    return { text: templateText, generatedBy: 'template', headline, affected, impact, action, eta };
  }

  // Brain on → phrase the SAME facts as a narrative. Lazy import so the model
  // client is never pulled in on the template path.
  try {
    const { chat } = await import('@/lib/hermes/openrouter');
    const facts = { headline, affected, impact, action, eta, monitoring: ctx.monitoringState, alerts: ctx.alerts.filter((a) => a.correlated) };
    const res = await chat({
      messages: [
        {
          role: 'system',
          content:
            'You are an incident commander drafting a concise public status update for stakeholders. ' +
            'Use ONLY the facts provided as JSON — never invent services, causes, timings, or an ETA that is not given. ' +
            'Keep it under 120 words, calm and factual, in four short labelled lines: Affected, Impact, What we are doing, ETA.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
      temperature: 0.2,
      maxTokens: 350,
    });
    if (res.ok && res.content && res.content.trim()) {
      return { text: res.content.trim(), generatedBy: 'llm', headline, affected, impact, action, eta, model: res.model };
    }
  } catch {
    /* fall through to template */
  }
  return { text: templateText, generatedBy: 'template', headline, affected, impact, action, eta };
}

// ---- Gating: queue the draft as a proposal (NO broadcast) ----------------

export async function queueStatusProposal(input: {
  incidentRef: string | null;
  draft: StatusDraft;
  context: IncidentContext;
  by?: string;
}): Promise<{ proposalId: string | null }> {
  const ref = input.incidentRef ?? 'INCIDENT';
  const proposal: HermesProposal = {
    ok: true,
    configured: true,
    classification: `Incident status update · ${input.context.monitoringState.overall}`,
    draft: input.draft.text,
    reasoning:
      'Stakeholder status update drafted by the Incident Commander from the assembled context. ' +
      'Approve to broadcast to the status channel; this is NOT posted automatically.',
    sources: input.context.relatedTickets.map((r) => r.ref),
  };
  const proposalId = await saveProposal({
    ref,
    agent: 'incident-commander',
    kind: 'incident-status',
    title: `Status update · ${input.draft.headline}`,
    summary: input.draft.text.slice(0, 240),
    proposal,
  });
  return { proposalId };
}

// ---- Gating: approve → run the broadcast, then mark the proposal sent -----
// Only ever called from the gated route on an explicit operator approval.

export async function approveStatusBroadcast(input: {
  proposalId: string;
  text: string;
  by: string;
}): Promise<{ ok: boolean; via?: string; error?: string }> {
  const res = await broadcastStatusTool.run(
    { text: input.text },
    { threadId: 'incident-commander', persona: 'incident', actor: input.by },
  );
  if (!res.ok) {
    return { ok: false, error: res.error ?? res.summary };
  }
  // Mark the proposal sent WITHOUT the legacy comment-post path (mark-sent).
  await actOnProposal(input.proposalId, 'mark-sent', input.by);
  const via = (res.data as any)?.via as string | undefined;
  return { ok: true, via };
}
