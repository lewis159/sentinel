// Churn-Save Outreach API — /api/v2/admin/churn-save
//
//   GET  → the ranked list of at-risk accounts (deterministic scorer; always works,
//          mock-safe). Includes whether the Brain will refine drafts.
//   POST → for a selected account: draft a win-back message, or queue it as a GATED
//          proposal for human approval. NOTHING sends here.
//
// Gated on the Hermes section (this is a Hermes-console surface). Both verbs
// recompute the account server-side from its key so the client can't inject a
// fabricated risk profile or recipient.
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { collectAtRiskAccounts } from '@/lib/churn/at-risk';
import { generateWinBack, queueWinBack } from '@/lib/churn/win-back';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  const { accounts, live } = await collectAtRiskAccounts();
  return NextResponse.json({ accounts, live, brain: brainEnabled() });
}

export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  let body: { action?: string; key?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const action = body.action === 'queue' ? 'queue' : 'draft';
  const key = (body.key ?? '').trim();
  if (!key) return NextResponse.json({ error: 'Missing account key.' }, { status: 400 });

  // Recompute the account from live signals — never trust a client-supplied score
  // or recipient for something that drafts an email.
  const { accounts } = await collectAtRiskAccounts();
  const account = accounts.find((a) => a.key === key);
  if (!account) {
    return NextResponse.json({ error: 'Account is no longer at risk (or unknown).' }, { status: 404 });
  }

  if (action === 'queue') {
    const { proposalId, draft } = await queueWinBack(account);
    return NextResponse.json({
      ok: true,
      queued: true,
      proposalId,
      draft,
      // With no DB, saveProposal is a no-op (null id) — the draft is still returned
      // so the operator sees exactly what WOULD be queued in production.
      persisted: proposalId !== null,
    });
  }

  const draft = await generateWinBack(account);
  return NextResponse.json({ ok: true, queued: false, draft });
}
