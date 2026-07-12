// Sales / Lead-qualification — persistence over the EXISTING ops.tickets table.
//
// DECISION (least-invasive, no schema change): a lead is a normal ticket of
// kind 'request' tagged `attrs.lead = true`. All lead-specific fields live in
// attrs (source, company, question, and the computed assessment) so we add NO
// column and NO new TicketKind. Reads filter on attrs.lead === true. This reuses
// createTicket()'s RLS/operator-identity handling (leads arrive with no Clerk
// session) and getTicketsByKind()'s DB-first + mock-fallback path unchanged.
import 'server-only';
import { createTicket, getTicketsByKind } from '@/lib/data';
import type { ServiceTicket } from '@/lib/mock';
import { qualifyLead, type LeadAssessment, type LeadInput } from './qualify';

// The public product these leads are for (mirrors the support-chat default).
const LEAD_APP = 'Scribuo';

export type LeadRecord = {
  ref: string;
  name: string | null;
  email: string | null;
  company: string | null;
  message: string;
  source: string;
  status: string;
  age: string;
  createdAt: string | null;
  flagged: boolean;            // hot-lead follow-up flag
  assessment: LeadAssessment;  // stored at intake; recomputed if missing
};

function s(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Map priority → the deterministic tier so a lead's rank still shows on the
// standard ticket surfaces (a hot lead is a high-priority request).
function tierToPriority(tier: LeadAssessment['tier']): 'high' | 'medium' | 'low' {
  return tier === 'hot' ? 'high' : tier === 'warm' ? 'medium' : 'low';
}

/**
 * Persist an inbound enquiry as a qualified lead ticket. Scores it deterministically
 * (pure) and stores the assessment on attrs. Returns the ref + assessment. Throws
 * only if the underlying createTicket throws (no DB) — callers handle that.
 */
export async function createLead(input: LeadInput): Promise<{ ref: string; assessment: LeadAssessment }> {
  const assessment = qualifyLead(input);
  const company = s(input.company);
  const name = s(input.name);
  const email = s(input.email);
  const message = s(input.message) ?? '';
  const source = s(input.source) ?? 'web';

  const label = company ?? name ?? email ?? 'Inbound lead';
  const title = `Lead · ${label}`.slice(0, 120);

  const { ref } = await createTicket({
    kind: 'request',
    title,
    description: message,
    app: LEAD_APP,
    impact: 'medium',
    urgency: assessment.tier === 'hot' ? 'high' : 'medium',
    priority: tierToPriority(assessment.tier),
    status: 'new',
    source: `lead:${source}`,
    customerEmail: email,
    customerName: name,
    attrs: {
      lead: true,
      lead_source: source,
      lead_company: company,
      lead_question: message,
      lead_flagged: assessment.tier === 'hot',
      lead_score: assessment.score,
      lead_tier: assessment.tier,
      lead_reasons: assessment.reasons,
      lead_signals: assessment.signals,
      channel: 'lead-form',
    },
  });

  return { ref, assessment };
}

// Reconstruct a LeadRecord from a ticket row, preferring the stored assessment
// and recomputing deterministically when a row predates it.
function toLeadRecord(t: ServiceTicket): LeadRecord {
  const a = t.attrs ?? {};
  const input: LeadInput = {
    name: t.customerName ?? null,
    email: t.customerEmail ?? null,
    company: (a.lead_company as string) ?? null,
    message: (a.lead_question as string) ?? t.description ?? '',
    source: (a.lead_source as string) ?? null,
  };

  const stored =
    typeof a.lead_score === 'number' && typeof a.lead_tier === 'string'
      ? ({
          score: a.lead_score as number,
          tier: a.lead_tier as LeadAssessment['tier'],
          reasons: Array.isArray(a.lead_reasons) ? (a.lead_reasons as string[]) : [],
          signals: (a.lead_signals as LeadAssessment['signals']) ?? qualifyLead(input).signals,
        } as LeadAssessment)
      : qualifyLead(input);

  return {
    ref: t.ref,
    name: t.customerName ?? null,
    email: t.customerEmail ?? null,
    company: input.company ?? null,
    message: input.message ?? '',
    source: input.source ?? 'web',
    status: t.status,
    age: t.age,
    createdAt: t.slaDue ?? null,
    flagged: a.lead_flagged === true || stored.tier === 'hot',
    assessment: stored,
  };
}

const TIER_RANK: Record<LeadAssessment['tier'], number> = { hot: 0, warm: 1, cold: 2 };

/**
 * List leads (ticket rows tagged attrs.lead) ranked hot → warm → cold, then by
 * score desc. DB-first via getTicketsByKind('request') with its mock fallback,
 * so the pipeline always renders. Returns { leads, live }.
 */
export async function listLeads(): Promise<{ leads: LeadRecord[]; live: boolean }> {
  const { rows, live } = await getTicketsByKind('request');
  const leads = rows
    .filter((t) => (t.attrs ?? {}).lead === true)
    .map(toLeadRecord)
    .sort(
      (a, b) =>
        TIER_RANK[a.assessment.tier] - TIER_RANK[b.assessment.tier] ||
        b.assessment.score - a.assessment.score,
    );
  return { leads, live };
}
