// v2 Sales / Lead-qualification admin API.
//
//   GET  /api/v2/admin/leads   → { live, leads: LeadRecord[] } ranked hot→cold.
//   POST /api/v2/admin/leads   → draft a GROUNDED pre-sale reply for a lead and
//                                persist it as a proposal (kind 'lead-reply') in
//                                the approval queue. DRAFT ONLY — never sends.
//
// Auth: Clerk section gate (Hermes) via requireSectionApi('hermes').
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { listLeads } from '@/lib/leads/store';
import { draftPresaleReply } from '@/lib/leads/refine';
import { getServiceTicket } from '@/lib/data';
import { saveProposal } from '@/lib/hermes/proposals';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  try {
    const { leads, live } = await listLeads();
    return NextResponse.json({ live, leads });
  } catch {
    return NextResponse.json({ live: false, leads: [] });
  }
}

const draftBodySchema = z.object({
  ref: z.string().trim().min(1).max(64),
  question: z.string().trim().max(8000).optional(),
}).strip();

export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  let bodyJson: unknown;
  try { bodyJson = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const parsed = draftBodySchema.safeParse(bodyJson);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  const { ref } = parsed.data;

  // Resolve the lead ticket so the draft is grounded in its actual question.
  const { row } = await getServiceTicket(ref);
  if (!row || (row.attrs ?? {}).lead !== true) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }

  const attrs = row.attrs ?? {};
  const question =
    parsed.data.question ??
    (attrs.lead_question as string) ??
    row.description ??
    '';
  if (!question.trim()) return NextResponse.json({ error: 'no question to answer' }, { status: 400 });

  // Draft a grounded pre-sale answer (KB retrieval; model refines when the Brain
  // is on, deterministic template otherwise). NEVER sent here.
  const draft = await draftPresaleReply({
    question,
    name: row.customerName ?? null,
    company: (attrs.lead_company as string) ?? null,
  });

  // Persist as a proposal in the approval queue — a human approves before any
  // reply is posted / emailed (gated). saveProposal is a no-op without a DB.
  const id = await saveProposal({
    ref,
    agent: 'Hermes · Sales',
    kind: 'lead-reply',
    title: `Pre-sale reply · ${row.title}`,
    summary: draft.grounded
      ? `Grounded in KB: ${draft.sources.map((s) => s.slug).join(', ')}`
      : 'No KB match — holding reply drafted for review',
    proposal: {
      ok: true,
      configured: true,
      classification: 'Sales · pre-sale question',
      draft: draft.draft,
      sources: draft.sources.map((s) => s.slug),
      model: draft.model,
      reasoning: 'Draft-only pre-sale reply awaiting approval before it is sent.',
    },
  });

  return NextResponse.json({
    ok: true,
    proposalId: id,
    draft: draft.draft,
    grounded: draft.grounded,
    sources: draft.sources.map((s) => ({ slug: s.slug, title: s.title })),
    persisted: id !== null,
  });
}
