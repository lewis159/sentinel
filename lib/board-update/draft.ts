// Board / Founder-Update narrative draft.
//
// Two render paths, both DRAFT-ONLY (Ben reviews + sends — there is NO auto-send;
// "sending" is a manual founder step, see saveBoardUpdateDraft below):
//
//   1. renderTemplate()  — DETERMINISTIC markdown, always. Pure string assembly
//                          over the assembled numbers; no model call.
//   2. buildDraft()      — when brainEnabled() is on, asks the model to write ONLY
//                          the opening summary prose, GROUNDED STRICTLY in the
//                          assembled facts (it is told to invent no metrics and to
//                          keep "no data" as "no data"). The hard metric strip,
//                          roadmap, support/ops and wins are ALWAYS the deterministic
//                          template — the model can never change a number. Model off
//                          or any failure → the deterministic summary line.

import { brainEnabled } from '@/lib/hermes/brain/flags';
import { callModel } from '@/lib/hermes/brain/model';
import { saveProposal } from '@/lib/hermes/proposals';
import type { BoardUpdate, MetricValue, SectionMeta } from './assemble';

export type DraftMode = 'template' | 'llm';
export type BoardDraft = { markdown: string; mode: DraftMode; model?: string };

// ---------------------------------------------------------------------------
// Deterministic render
// ---------------------------------------------------------------------------

function metricLine(label: string, m: MetricValue): string {
  if (m.available) return `- **${label}:** ${m.display}  \n  _source: ${m.source}_`;
  return `- **${label}:** _no data_ — ${m.todo ?? 'source not wired'}`;
}

function noData(meta: SectionMeta): string {
  return `_No data_ — ${meta.note ?? 'source not available'} (source: ${meta.source}).`;
}

// A one-line deterministic summary distilled from what actually has data.
export function deterministicSummary(u: BoardUpdate): string {
  const bits: string[] = [];
  if (u.metrics.newRevenue.available) bits.push(`new revenue ${u.metrics.newRevenue.display}`);
  if (u.roadmap.hasData) bits.push(`${u.roadmap.shipped.length} shipped / ${u.roadmap.inFlight.length} in flight`);
  if (u.support.hasData) bits.push(`${u.support.ticketVolume} support tickets (${u.support.resolved} resolved)`);
  if (u.ops.hasData) bits.push(`${u.ops.incidents} incident${u.ops.incidents === 1 ? '' : 's'}`);
  const body = bits.length ? bits.join(', ') : 'limited data this period';
  return `${u.period}: ${body}.`;
}

export function renderTemplate(u: BoardUpdate, summaryOverride?: string): string {
  const L: string[] = [];
  L.push(`# Board update — ${u.period}`);
  L.push('');
  L.push(`_Draft assembled ${u.generatedAt}. Review, edit and send manually — this is a draft only._`);
  L.push('');

  L.push('## Summary');
  L.push(summaryOverride?.trim() ? summaryOverride.trim() : deterministicSummary(u));
  L.push('');

  L.push('## Headline metrics');
  L.push(metricLine('MRR', u.metrics.mrr));
  L.push(metricLine('New revenue (period)', u.metrics.newRevenue));
  L.push(metricLine('Churn', u.metrics.churn));
  L.push(metricLine('Runway', u.metrics.runway));
  L.push('');

  L.push('## What shipped');
  if (u.roadmap.shipped.length > 0) {
    for (const s of u.roadmap.shipped) L.push(`- ${s.title}${s.app ? ` _(${s.app})_` : ''}`);
  } else {
    L.push(u.roadmap.hasData ? '_Nothing marked shipped this period._' : noData(u.roadmap));
  }
  L.push('');

  L.push("## What's next (in flight)");
  if (u.roadmap.inFlight.length > 0) {
    for (const s of u.roadmap.inFlight) L.push(`- ${s.title}${s.app ? ` _(${s.app})_` : ''} — ${s.status.replace('_', ' ')}`);
  } else {
    L.push(u.roadmap.hasData ? '_Nothing currently in flight._' : noData(u.roadmap));
  }
  L.push('');

  L.push('## Support & ops health');
  if (u.support.hasData) {
    L.push(`- Support: ${u.support.ticketVolume} tickets — ${u.support.resolved} resolved, ${u.support.open} open, ${u.support.slaBreaches} SLA breach${u.support.slaBreaches === 1 ? '' : 'es'}.`);
  } else {
    L.push(`- Support: ${noData(u.support)}`);
  }
  if (u.ops.hasData) {
    L.push(`- Ops: ${u.ops.incidents} incident${u.ops.incidents === 1 ? '' : 's'} (${u.ops.incidentsResolved} resolved). Uptime: ${u.ops.uptime.available ? u.ops.uptime.display : 'no data'}.`);
  } else {
    L.push(`- Ops: ${noData(u.ops)}`);
  }
  L.push('');

  L.push('## Wins');
  if (u.wins.items.length > 0) {
    for (const w of u.wins.items) L.push(`- ${w}`);
  } else {
    L.push(noData(u.wins));
  }
  L.push('');

  L.push('## Risks');
  const risks: string[] = [];
  if (u.support.slaBreaches > 0) risks.push(`${u.support.slaBreaches} SLA breach${u.support.slaBreaches === 1 ? '' : 'es'} this period.`);
  const openIncidents = u.ops.incidents - u.ops.incidentsResolved;
  if (openIncidents > 0) risks.push(`${openIncidents} incident${openIncidents === 1 ? '' : 's'} still open.`);
  if (!u.metrics.mrr.available) risks.push('No MRR/churn source wired — revenue reporting is incomplete.');
  if (risks.length > 0) {
    for (const r of risks) L.push(`- ${r}`);
  } else {
    L.push('_No material risks flagged from the assembled data._');
  }
  L.push('');

  L.push('## Asks');
  L.push('_Founder to fill in — this section is intentionally left for you to add specific asks._');
  L.push('');

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// LLM-narrated draft (grounded, no-fabrication)
// ---------------------------------------------------------------------------

// A compact, faithful fact sheet the model may draw on — and ONLY this.
function factSheet(u: BoardUpdate): string {
  const metric = (k: string, m: MetricValue) => `${k}: ${m.available ? m.display : 'no data'}`;
  return [
    `Period: ${u.period}`,
    metric('MRR', u.metrics.mrr),
    metric('New revenue', u.metrics.newRevenue),
    metric('Churn', u.metrics.churn),
    metric('Runway', u.metrics.runway),
    `Shipped (${u.roadmap.shipped.length}): ${u.roadmap.shipped.map((s) => s.title).join('; ') || 'none'}`,
    `In flight (${u.roadmap.inFlight.length}): ${u.roadmap.inFlight.map((s) => s.title).join('; ') || 'none'}`,
    u.support.hasData
      ? `Support: ${u.support.ticketVolume} tickets, ${u.support.resolved} resolved, ${u.support.slaBreaches} SLA breaches`
      : 'Support: no data',
    u.ops.hasData
      ? `Ops: ${u.ops.incidents} incidents, ${u.ops.incidentsResolved} resolved, uptime ${u.ops.uptime.available ? u.ops.uptime.display : 'no data'}`
      : 'Ops: no data',
    `Wins: ${u.wins.items.join('; ') || 'none derivable'}`,
  ].join('\n');
}

async function llmSummary(u: BoardUpdate): Promise<{ text: string; model?: string } | null> {
  const facts = factSheet(u);
  const res = await callModel({
    temperature: 0.3,
    maxTokens: 320,
    messages: [
      {
        role: 'system',
        content:
          'You write the opening SUMMARY paragraph of a monthly board/investor update for a founder. ' +
          'Use ONLY the facts provided — do NOT invent, estimate, or extrapolate any metric or figure. ' +
          'If a figure is "no data", do NOT fabricate it; either omit it or say it is not yet available. ' +
          'No headings, no bullet lists, no markdown — 2-4 plain sentences of prose. Confident, concise, honest.',
      },
      { role: 'user', content: `Facts:\n${facts}\n\nWrite the summary paragraph.` },
    ],
  });
  if (!res.ok || !res.content.trim()) return null;
  return { text: res.content.trim(), model: res.model };
}

// Build the final draft. LLM narrative only when the Brain is enabled; otherwise
// (or on any model failure) the deterministic template — always mock-safe.
export async function buildDraft(u: BoardUpdate, opts?: { noLlm?: boolean }): Promise<BoardDraft> {
  if (!opts?.noLlm && brainEnabled()) {
    const s = await llmSummary(u);
    if (s) return { markdown: renderTemplate(u, s.text), mode: 'llm', model: s.model };
  }
  return { markdown: renderTemplate(u), mode: 'template' };
}

// ---------------------------------------------------------------------------
// Save (draft only — NEVER auto-sends)
// ---------------------------------------------------------------------------

// Persist the assembled draft to the proposal queue as kind 'board-update'.
// This is where the founder's review begins: nothing is emailed or posted — the
// markdown is stored for Ben to copy, finish and send by hand. Returns the new
// proposal id, or null with no DB (mock-safe no-op).
export async function saveBoardUpdateDraft(u: BoardUpdate, markdown: string): Promise<string | null> {
  return saveProposal({
    ref: `board-update:${u.period}`,
    agent: 'orchestrator',
    kind: 'board-update',
    title: `Board update — ${u.period}`,
    summary: deterministicSummary(u),
    proposal: {
      ok: true,
      configured: true,
      classification: 'Board / founder update',
      draft: markdown,
      reasoning:
        'Assembled monthly board/founder update from read-only estate data. Draft only — review, edit and send manually (no auto-send).',
    },
  });
}
