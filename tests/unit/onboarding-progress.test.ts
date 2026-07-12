import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Onboarding assistant — PURE first-success + unused-feature computation
// (lib/onboarding/progress.ts + lib/onboarding/tiers.ts). No DB, no server-only,
// no LLM — imported directly. This is the deterministic substance the route +
// page render, so it's where the milestone logic, the percentage, and the
// tier→feature gap are pinned down.
// ---------------------------------------------------------------------------

import {
  computeMilestones,
  firstSuccessPct,
  unusedFeatures,
  computeOnboardingProgress,
  buildNudgeTemplate,
  daysSince,
  type OnboardingCustomer,
} from '@/lib/onboarding/progress';
import { featuresForTier, normalizeTier } from '@/lib/onboarding/tiers';

const NOW = new Date('2026-07-12T12:00:00Z');

function customer(over: Partial<OnboardingCustomer> = {}): OnboardingCustomer {
  return {
    id: 'acme',
    name: 'Acme Co',
    email: 'ops@acme.co',
    tier: 'pro',
    signupAt: new Date('2026-07-10T12:00:00Z').toISOString(), // 2 days ago
    memberCount: 3,
    hasFirstJob: true,
    jobCount: 5,
    usedFeatures: ['transcribe'],
    contactedSupport: true,
    ...over,
  };
}

describe('daysSince', () => {
  it('floors whole days from signup to now', () => {
    expect(daysSince('2026-07-10T12:00:00Z', NOW)).toBe(2);
    expect(daysSince('2026-07-12T00:00:00Z', NOW)).toBe(0);
  });
  it('never goes negative and handles unknown/invalid', () => {
    expect(daysSince('2026-08-01T00:00:00Z', NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('not-a-date', NOW)).toBeNull();
  });
});

describe('computeMilestones — done / not-done / unknown', () => {
  it('marks account + first job + team + explored when the data supports it', () => {
    const m = computeMilestones(customer({ usedFeatures: ['transcribe', 'ai_summary'] }));
    const by = Object.fromEntries(m.map((x) => [x.key, x]));
    expect(by.account_setup.done).toBe(true);
    expect(by.first_job.done).toBe(true);
    expect(by.invited_teammate.done).toBe(true); // memberCount 3 > 1
    expect(by.explored_feature.done).toBe(true); // used ai_summary beyond transcribe
    expect(m.every((x) => !x.unknown)).toBe(true);
  });

  it('flags UNKNOWN (not done) when the underlying data is absent', () => {
    const m = computeMilestones(
      customer({
        signupAt: null,
        hasFirstJob: null,
        jobCount: null,
        memberCount: null,
        usedFeatures: [],
      }),
    );
    const by = Object.fromEntries(m.map((x) => [x.key, x]));
    // No signup timestamp → account milestone unknown + not done.
    expect(by.account_setup.done).toBe(false);
    expect(by.account_setup.unknown).toBe(true);
    // No job/usage data → unknown, not a hard "incomplete".
    expect(by.first_job.done).toBe(false);
    expect(by.first_job.unknown).toBe(true);
    expect(by.invited_teammate.unknown).toBe(true);
    expect(by.explored_feature.unknown).toBe(true);
  });

  it('a solo account with only a transcript: team not done, explored not done', () => {
    const m = computeMilestones(
      customer({ memberCount: 1, usedFeatures: ['transcribe'], hasFirstJob: true }),
    );
    const by = Object.fromEntries(m.map((x) => [x.key, x]));
    expect(by.first_job.done).toBe(true);
    expect(by.invited_teammate.done).toBe(false);
    expect(by.invited_teammate.unknown).toBe(false); // memberCount known
    expect(by.explored_feature.done).toBe(false);
  });
});

describe('firstSuccessPct — done ÷ total, unknown counts as not done', () => {
  it('all four done → 100', () => {
    expect(firstSuccessPct(computeMilestones(customer({ usedFeatures: ['transcribe', 'ai_summary'] })))).toBe(100);
  });
  it('two of four done → 50', () => {
    const m = computeMilestones(customer({ memberCount: 1, usedFeatures: ['transcribe'] }));
    // account ✓, first_job ✓, team ✗, explored ✗
    expect(firstSuccessPct(m)).toBe(50);
  });
  it('all unknown → 0', () => {
    const m = computeMilestones(
      customer({ signupAt: null, hasFirstJob: null, jobCount: null, memberCount: null, usedFeatures: [] }),
    );
    expect(firstSuccessPct(m)).toBe(0);
  });
});

describe('unusedFeatures — tier map gap, richest-value first', () => {
  it('returns on-tier features the customer has not used, top-priority first', () => {
    const u = unusedFeatures(customer({ tier: 'pro', usedFeatures: ['transcribe'] }));
    const keys = u.map((f) => f.key);
    // Pro unlocks these; transcribe is used so it's excluded.
    expect(keys).not.toContain('transcribe');
    expect(keys).toContain('ai_summary');
    expect(keys).toContain('full_text_search');
    // ai_summary has the highest priority among the remaining → surfaces first.
    expect(keys[0]).toBe('ai_summary');
    // Studio-only features (clips/dub) are NOT offered to a Pro customer.
    expect(keys).not.toContain('clips');
    expect(keys).not.toContain('dub');
  });

  it('is empty when every on-tier feature has been used', () => {
    const all = featuresForTier('free'); // free = ['transcribe']
    expect(unusedFeatures(customer({ tier: 'free', usedFeatures: all }))).toEqual([]);
  });

  it('respects tier: a Studio customer is offered clips/dub/teams', () => {
    const keys = unusedFeatures(customer({ tier: 'studio', usedFeatures: ['transcribe'] })).map((f) => f.key);
    expect(keys).toContain('clips');
    expect(keys).toContain('dub');
    expect(keys).toContain('teams');
  });
});

describe('normalizeTier', () => {
  it('passes through known tiers and maps aliases; unknown → free', () => {
    expect(normalizeTier('Pro')).toBe('pro');
    expect(normalizeTier('agency')).toBe('reseller');
    expect(normalizeTier('team')).toBe('studio');
    expect(normalizeTier('mystery')).toBe('free');
    expect(normalizeTier(null)).toBe('free');
  });
});

describe('computeOnboardingProgress — end to end', () => {
  it('assembles a deterministic view with stage + top unused feature', () => {
    const p = computeOnboardingProgress(customer({ tier: 'pro', usedFeatures: ['transcribe'] }), NOW);
    expect(p.customerId).toBe('acme');
    expect(p.tier).toBe('pro');
    expect(p.tierLabel).toBe('Pro');
    expect(p.daysSinceSignup).toBe(2);
    expect(p.firstSuccessPct).toBe(75); // account ✓ job ✓ team ✓ explored ✗
    expect(p.topUnusedFeature?.key).toBe('ai_summary');
    expect(p.stage).toBe('active'); // pct >= 75
  });

  it('classifies a 9-day-old account with no first job as stalled', () => {
    const p = computeOnboardingProgress(
      customer({
        signupAt: new Date('2026-07-03T12:00:00Z').toISOString(),
        hasFirstJob: false,
        jobCount: 0,
        memberCount: 1,
        usedFeatures: [],
      }),
      NOW,
    );
    expect(p.daysSinceSignup).toBe(9);
    expect(p.stage).toBe('stalled');
  });

  it('is a pure function — identical input yields identical output', () => {
    const c = customer();
    expect(computeOnboardingProgress(c, NOW)).toEqual(computeOnboardingProgress(c, NOW));
  });
});

describe('buildNudgeTemplate — deterministic baseline copy', () => {
  it('highlights the top unused feature and is never marked personalised', () => {
    const p = computeOnboardingProgress(customer({ tier: 'pro', usedFeatures: ['transcribe'] }), NOW);
    const n = buildNudgeTemplate(p);
    expect(n.personalised).toBe(false);
    expect(n.featureKey).toBe('ai_summary');
    expect(n.subject).toContain('AI summary');
    expect(n.body).toContain('Acme'); // greeting derived from the name
    expect(n.body).toContain('Pro'); // tier named
  });

  it('falls back to an "all set" note when nothing is unused', () => {
    const p = computeOnboardingProgress(customer({ tier: 'free', usedFeatures: ['transcribe'] }), NOW);
    const n = buildNudgeTemplate(p);
    expect(n.featureKey).toBeNull();
    expect(n.subject).toMatch(/most out of/i);
  });
});
