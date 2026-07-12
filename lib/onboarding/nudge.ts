// Onboarding — nudge drafting + queueing (SERVER-ONLY).
//
// Dormant-safe by design:
//   • buildNudgeTemplate (pure, in ./progress) ALWAYS produces a deterministic
//     baseline nudge — the recommendation (top unused feature) is chosen there.
//   • draftNudge() only reaches for the LLM to PERSONALISE the wording, and ONLY
//     when HERMES_BRAIN_ENABLED is on AND an OpenRouter key is configured. When
//     the Brain is off (the default) NO model call happens — the template ships.
//   • queueNudge() raises the draft to the human approval queue via the existing
//     saveProposal() (kind `onboarding-nudge`). It NEVER sends: approval + the
//     gated email tool are the only send path, and that stays behind the gate.

import 'server-only';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { chat } from '@/lib/hermes/openrouter';
import { saveProposal } from '@/lib/hermes/proposals';
import { buildNudgeTemplate, type NudgeDraft, type OnboardingProgress } from './progress';

// Proposal kind for onboarding nudges. Kept OUT of the privileged-kind set so it
// routes as a normal copilot DRAFT (human approves → posts/handled), not a
// money/account action.
export const ONBOARDING_NUDGE_KIND = 'onboarding-nudge';

// Ask the model to rewrite ONLY the body copy, warmer + more specific, without
// changing the recommended feature or inventing facts. Falls back to the template
// on any failure so the caller always gets a usable draft.
async function personalise(
  base: NudgeDraft,
  p: OnboardingProgress,
): Promise<NudgeDraft> {
  const featureLine = base.featureKey
    ? `Recommended feature to highlight: ${p.topUnusedFeature?.label} — ${p.topUnusedFeature?.description}`
    : `The customer has already tried the headline features; keep it a brief, friendly check-in.`;

  const res = await chat({
    temperature: 0.4,
    maxTokens: 400,
    messages: [
      {
        role: 'system',
        content:
          'You write short, warm onboarding nudge emails for Scribuo (a transcription SaaS). ' +
          'Rewrite the given draft to feel personal and specific. Do NOT change which feature is ' +
          'recommended, do NOT invent facts, usage numbers, or discounts, and keep it under 120 words. ' +
          'Return ONLY the email body text — no subject line, no preamble.',
      },
      {
        role: 'user',
        content:
          `Customer: ${p.name} (${p.tierLabel} plan, first-success ${p.firstSuccessPct}%).\n` +
          `${featureLine}\n\n` +
          `Draft to improve:\n${base.body}`,
      },
    ],
  });

  if (!res.ok || !res.content?.trim()) return base;
  return {
    ...base,
    body: res.content.trim(),
    personalised: true,
    model: res.model,
  };
}

/**
 * Draft a "here's what to try next" nudge for a customer.
 * Brain OFF (default) → deterministic template, guaranteed no model call.
 * Brain ON + key set   → template personalised by the LLM (falls back to template).
 */
export async function draftNudge(p: OnboardingProgress): Promise<NudgeDraft> {
  const base = buildNudgeTemplate(p);
  if (!brainEnabled()) return base;
  try {
    return await personalise(base, p);
  } catch {
    // Never let personalisation failure break the draft.
    return base;
  }
}

/**
 * Draft (as above) and QUEUE the nudge to the human approval gate. Returns the
 * proposal id (null with no DB — proposals persist in prod). NOTHING is sent:
 * the draft sits in the Approvals queue for a human to approve, and only the
 * gated email path can then send it.
 */
export async function queueNudge(input: {
  progress: OnboardingProgress;
  by?: string;
}): Promise<{ ok: boolean; proposalId: string | null; draft: NudgeDraft }> {
  const { progress } = input;
  const draft = await draftNudge(progress);

  const to = progress.email ?? progress.customerId;
  const proposalId = await saveProposal({
    ref: progress.customerId,
    agent: 'onboarding',
    kind: ONBOARDING_NUDGE_KIND,
    title: `Onboarding nudge → ${progress.name}`,
    summary:
      `Suggest "${draft.featureKey ? progress.topUnusedFeature?.label : 'check-in'}" to ${to} ` +
      `(${progress.tierLabel}, ${progress.firstSuccessPct}% first-success). Draft only — approve to send.`,
    proposal: {
      ok: true,
      configured: true,
      classification: `Onboarding · ${draft.featureKey ? 'feature nudge' : 'check-in'}`,
      draft: `Subject: ${draft.subject}\n\n${draft.body}`,
      reasoning:
        `${progress.name} is at ${progress.firstSuccessPct}% first-success on the ${progress.tierLabel} ` +
        `plan. Surfacing the top unused feature to help them reach value. This is a DRAFT — a human must ` +
        `approve before any message is sent; nothing sends automatically.`,
      model: draft.model,
    },
  });

  return { ok: true, proposalId, draft };
}
