// Onboarding — PURE, deterministic first-success + unused-feature computation.
//
// No server-only, no DB, no LLM. Given a plain snapshot of what we know about a
// customer (assembled elsewhere from tickets / entitlements / usage, or from a
// mock), this computes:
//   • milestones      — the key first-success steps, each done / not-done /
//                        unknown (data absent → NOT done, flagged unknown).
//   • firstSuccessPct  — done milestones ÷ total, 0-100 integer.
//   • unusedFeatures   — tier features the customer hasn't touched yet.
//   • topUnusedFeature — the single highest-value unused feature to nudge about.
//
// Deterministic: same input → same output. `now` is injectable so tests are
// stable. This is the substance the route + page + tests exercise.

import {
  FEATURES,
  featureDef,
  featuresForTier,
  normalizeTier,
  TIER_LABEL,
  type FeatureKey,
  type TierKey,
} from './tiers';

// ── Input snapshot ──────────────────────────────────────────────────────────
// Everything is optional/nullable so the assembler can pass through only what it
// actually knows. Absent data → the relevant milestone is `unknown` (not done).
export type OnboardingCustomer = {
  id: string;
  name: string;
  email: string | null;
  tier: string | null;
  // ISO timestamp of signup / account creation, or null when unknown.
  signupAt: string | null;
  // Number of members/seats on the account. null = unknown.
  memberCount: number | null;
  // Whether the account has produced at least one transcript/job. null = unknown.
  hasFirstJob: boolean | null;
  // How many jobs/transcripts (best-effort). Used only to enrich display.
  jobCount: number | null;
  // Feature keys we have positive evidence the customer has USED.
  usedFeatures: FeatureKey[];
  // Whether they've opened a support conversation (engagement signal). null = unknown.
  contactedSupport: boolean | null;
};

export type Milestone = {
  key: string;
  label: string;
  done: boolean;
  // True when we have no data to decide (counts as NOT done, but the UI shows a
  // muted "unknown" state rather than a hard "incomplete").
  unknown: boolean;
  hint?: string;
};

export type UnusedFeature = {
  key: FeatureKey;
  label: string;
  description: string;
  tryHref?: string;
};

export type OnboardingProgress = {
  customerId: string;
  name: string;
  email: string | null;
  tier: TierKey;
  tierLabel: string;
  daysSinceSignup: number | null;
  milestones: Milestone[];
  firstSuccessPct: number;
  doneCount: number;
  totalCount: number;
  unusedFeatures: UnusedFeature[];
  topUnusedFeature: UnusedFeature | null;
  // A coarse lifecycle label handy for sorting/filtering the board.
  stage: 'new' | 'activating' | 'active' | 'stalled';
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole days between signup and `now` (floored, never negative). null when we
// don't know when they signed up.
export function daysSince(
  signupAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!signupAt) return null;
  const t = Date.parse(signupAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

// Compute the first-success milestone checklist. Order is the natural onboarding
// journey. `unknown` milestones count as NOT done for the percentage.
export function computeMilestones(c: OnboardingCustomer): Milestone[] {
  const used = new Set<FeatureKey>(c.usedFeatures ?? []);

  // 1. Account set up — we have a real signup timestamp for them.
  const accountDone = Boolean(c.signupAt);

  // 2. First transcript / job — the core "aha" moment.
  const firstJobKnown = c.hasFirstJob !== null || (c.jobCount ?? null) !== null || used.has('transcribe');
  const firstJobDone =
    c.hasFirstJob === true || (c.jobCount ?? 0) > 0 || used.has('transcribe');

  // 3. Invited a teammate — collaboration signal.
  const teamKnown = c.memberCount !== null || used.has('teams');
  const teamDone = (c.memberCount ?? 0) > 1 || used.has('teams');

  // 4. Tried a value feature beyond the basics.
  const wentBeyond = [...used].some((k) => k !== 'transcribe');
  const beyondKnown = (c.usedFeatures?.length ?? 0) > 0 || firstJobKnown;
  const beyondDone = wentBeyond;

  return [
    {
      key: 'account_setup',
      label: 'Account created',
      done: accountDone,
      unknown: !accountDone && c.signupAt === null,
      hint: 'Signed up and workspace ready',
    },
    {
      key: 'first_job',
      label: 'First transcript created',
      done: firstJobDone,
      unknown: !firstJobDone && !firstJobKnown,
      hint: 'Produced their first transcript/job',
    },
    {
      key: 'invited_teammate',
      label: 'Invited a teammate',
      done: teamDone,
      unknown: !teamDone && !teamKnown,
      hint: 'Added a second member to the workspace',
    },
    {
      key: 'explored_feature',
      label: 'Explored a key feature',
      done: beyondDone,
      unknown: !beyondDone && !beyondKnown,
      hint: 'Used a feature beyond basic transcription',
    },
  ];
}

// done ÷ total, as a 0-100 integer. Unknown milestones are NOT done.
export function firstSuccessPct(milestones: Milestone[]): number {
  if (milestones.length === 0) return 0;
  const done = milestones.filter((m) => m.done).length;
  return Math.round((done / milestones.length) * 100);
}

// Features on the customer's tier they haven't used yet, richest-value first.
export function unusedFeatures(c: OnboardingCustomer): UnusedFeature[] {
  const used = new Set<FeatureKey>(c.usedFeatures ?? []);
  const onTier = new Set<FeatureKey>(featuresForTier(c.tier));
  // Walk FEATURES in priority order (already sorted high→low in the catalog) and
  // keep those on-tier + unused. Deterministic.
  return FEATURES.filter((f) => onTier.has(f.key) && !used.has(f.key)).map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    tryHref: f.tryHref,
  }));
}

// Coarse lifecycle stage, purely from the deterministic signals.
function computeStage(
  pct: number,
  days: number | null,
  firstJobDone: boolean,
): OnboardingProgress['stage'] {
  if (pct >= 75) return 'active';
  if (!firstJobDone && days !== null && days >= 7) return 'stalled';
  if (pct <= 25) return 'new';
  return 'activating';
}

// The single top-level entry point: snapshot → full progress view.
export function computeOnboardingProgress(
  c: OnboardingCustomer,
  now: Date = new Date(),
): OnboardingProgress {
  const milestones = computeMilestones(c);
  const pct = firstSuccessPct(milestones);
  const unused = unusedFeatures(c);
  const days = daysSince(c.signupAt, now);
  const tier = normalizeTier(c.tier);
  const firstJobDone = milestones.find((m) => m.key === 'first_job')?.done ?? false;

  return {
    customerId: c.id,
    name: c.name,
    email: c.email,
    tier,
    tierLabel: TIER_LABEL[tier],
    daysSinceSignup: days,
    milestones,
    firstSuccessPct: pct,
    doneCount: milestones.filter((m) => m.done).length,
    totalCount: milestones.length,
    unusedFeatures: unused,
    topUnusedFeature: unused[0] ?? null,
    stage: computeStage(pct, days, firstJobDone),
  };
}

// ── Nudge template (PURE) ────────────────────────────────────────────────────
// The deterministic baseline nudge, always available even when the Brain is off.
// The LLM path (lib/onboarding/nudge.ts) only PERSONALISES this copy; it never
// invents the recommendation — the top unused feature is chosen here.
export type NudgeDraft = {
  subject: string;
  body: string;
  featureKey: FeatureKey | null;
  personalised: boolean; // true only when an LLM rewrote the body
  model?: string;
};

export function buildNudgeTemplate(p: OnboardingProgress): NudgeDraft {
  const first = p.name?.split(/[@\s.]/)[0] || 'there';
  const greetName = first.charAt(0).toUpperCase() + first.slice(1);
  const top = p.topUnusedFeature;

  if (!top) {
    // Nothing left to surface — a gentle "you're all set" note.
    const body =
      `Hi ${greetName},\n\n` +
      `You're making great use of your ${p.tierLabel} plan — you've already tried the headline features. ` +
      `If there's anything you'd like a hand with, just reply and we'll help.\n\n` +
      `— The Scribuo team`;
    return { subject: `You're getting the most out of Scribuo`, body, featureKey: null, personalised: false };
  }

  const def = featureDef(top.key);
  const body =
    `Hi ${greetName},\n\n` +
    `Thanks for getting started with Scribuo. One feature on your ${p.tierLabel} plan you haven't tried yet is ${top.label} — ${top.description}\n\n` +
    `It only takes a moment to try, and it's already included in your plan.\n\n` +
    `Want a quick walkthrough? Just reply and we'll get you set up.\n\n` +
    `— The Scribuo team`;

  return {
    subject: `Try ${def.label} — it's included in your ${p.tierLabel} plan`,
    body,
    featureKey: top.key,
    personalised: false,
  };
}
