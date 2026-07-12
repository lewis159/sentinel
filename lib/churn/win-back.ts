// Churn-Save — win-back draft generator + gated queue.
//
// For a selected at-risk account we produce a personalised win-back email. TWO
// layers, so it works dormant and only gets smarter when the Brain is on:
//   • BASELINE (always): a deterministic template tailored to the account's risk
//     reasons. No network, no LLM — always available, mock-safe.
//   • REFINED (opt-in): when brainEnabled() is on, callModel() rewrites the BODY
//     into a warmer, more specific message grounded in the same reasons. Subject +
//     recipient stay deterministic. If the model is unconfigured or errors, we
//     silently fall back to the template — never a broken draft.
//
// GATING — NOTHING SENDS HERE. This module only DRAFTS and, on request, persists a
// DRAFT proposal (kind 'churn-save') via the existing proposal spine. There is no
// action block and no Resend call, so approval routes through the human gate in the
// Sentinel Approvals queue exactly like the dunning drafts — a human is the only
// thing that ever sends a win-back email.
import 'server-only';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { callModel } from '@/lib/hermes/brain/model';
import { saveProposal } from '@/lib/hermes/proposals';
import type { AtRiskAccount } from '@/lib/churn/at-risk';

// The subset of an at-risk account the drafter needs.
export type WinBackTarget = Pick<AtRiskAccount, 'label' | 'email' | 'reasons' | 'riskScore' | 'tenantRef' | 'key'> & {
  failedPayments?: number;
};

export type WinBackDraft = {
  to: string | null;
  subject: string;
  body: string;
  refined: boolean; // true → the LLM rewrote the body
  model?: string;
};

function firstName(label: string): string {
  const t = (label || '').trim();
  if (!t) return 'there';
  if (t.includes('@')) return 'there';
  return t.split(/\s+/)[0];
}

/**
 * Deterministic template win-back. Always available; tailored to the reasons.
 */
export function templateWinBack(a: WinBackTarget): WinBackDraft {
  const name = firstName(a.label);
  const hasBilling = (a.failedPayments ?? 0) > 0 || a.reasons.some((r) => /failed payment|dunning/i.test(r));
  const hasComplaint = a.reasons.some((r) => /negative sentiment|complaint/i.test(r));
  const hasStalled = a.reasons.some((r) => /stalled|urgent open|high-priority/i.test(r));

  const subject = hasBilling
    ? 'We’d hate to see your Scribuo service lapse'
    : hasComplaint
      ? 'We want to make this right'
      : 'Checking in — is Scribuo still working for you?';

  const lines: string[] = [`Hi ${name},`, ''];
  if (hasComplaint) {
    lines.push(
      'We noticed a recent issue on your account and we’re sorry it fell short. Your experience matters to us and we’d like to put it right personally.',
    );
  } else if (hasBilling) {
    lines.push(
      'We spotted a payment on your account that didn’t go through, and we don’t want that to interrupt your service.',
    );
  } else {
    lines.push('We noticed things have been quiet on your account and wanted to check in.');
  }
  lines.push('');
  if (hasBilling) {
    lines.push(
      'If you update your payment details we’ll keep everything running without a break — and if now isn’t the right time, just reply and we’ll work something out.',
    );
  } else if (hasStalled) {
    lines.push(
      'If there’s an open request we can push over the line for you, reply to this email and it goes straight to a real person on our team.',
    );
  } else {
    lines.push(
      'If there’s anything we can do to make Scribuo more useful for you, reply and it comes straight to us — no bots.',
    );
  }
  lines.push('');
  lines.push('We’d genuinely love to keep working with you.');
  lines.push('');
  lines.push('— The Scribuo team');

  return { to: a.email, subject, body: lines.join('\n'), refined: false };
}

/**
 * Produce a win-back draft. Template baseline; when the Brain is enabled, refine
 * the body via the model. DRAFT ONLY — never sends.
 */
export async function generateWinBack(a: WinBackTarget): Promise<WinBackDraft> {
  const base = templateWinBack(a);
  if (!brainEnabled()) return base;

  const system =
    'You are a retention specialist writing a short, warm, personal win-back email to an at-risk SaaS customer of Scribuo. ' +
    'Be human and specific to the reasons given. No pushy discounts, no marketing fluff. 90-130 words. ' +
    'Return ONLY the email body (no subject line, no preamble). Sign off as "— The Scribuo team".';
  const user =
    `Customer: ${a.label}\n` +
    `Risk score: ${a.riskScore}/100\n` +
    `Why they are at risk:\n- ${a.reasons.join('\n- ')}\n\n` +
    'Write the win-back email body.';

  try {
    const res = await callModel({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.5,
      maxTokens: 400,
    });
    if (res.ok && res.content && res.content.trim().length > 20) {
      return { ...base, body: res.content.trim(), refined: true, model: res.model };
    }
  } catch {
    /* fall back to the template */
  }
  return base;
}

/**
 * Persist a win-back draft as a GATED proposal (kind 'churn-save'). Returns the
 * proposal id + the draft that was queued. NO send, NO action block — approval
 * flows through the human gate in the Approvals queue, never auto-executed.
 */
export async function queueWinBack(a: AtRiskAccount): Promise<{ proposalId: string | null; draft: WinBackDraft }> {
  const draft = await generateWinBack(a);
  const ref = a.tenantRef
    ? `tenant:${a.tenantRef}`
    : a.email
      ? `email:${a.email}`
      : `account:${a.key}`;

  const proposalId = await saveProposal({
    ref,
    agent: 'churn-save',
    kind: 'churn-save',
    title: `Win-back — ${a.label}`,
    summary:
      `Draft win-back email to ${draft.to ?? a.email ?? 'customer'} · subject "${draft.subject}". ` +
      'Review + approve to send — nothing is sent automatically.',
    proposal: {
      ok: true,
      configured: true,
      classification: `Win-back · ${draft.subject}`,
      priority: a.riskScore >= 60 ? 'high' : 'medium',
      draft: draft.body,
      reasoning:
        `At-risk (${a.riskScore}/100): ${a.reasons.join('; ')}. ` +
        'Drafted a win-back message for human review — gated, never auto-sent.',
      sources: draft.to ? [draft.to] : [],
      confidence: Math.min(95, a.riskScore),
      model: draft.model,
      // NB: intentionally NO `action` block. A churn-save proposal is a copilot
      // DRAFT — approving it goes through the existing human-gate path, it never
      // resumes a graph or fires the Resend tool on its own.
    },
  });

  return { proposalId, draft };
}
