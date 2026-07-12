import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Customer-Health Digest tests. Two layers:
//   1. lib/health/score.ts — PURE scorer: thriving vs critical banding, driver
//      generation, monotonicity, upsell threshold (via detectUpsell in digest).
//   2. lib/health/digest.ts — portfolio roll-up: band counts, at-risk + upsell
//      detection, and the brain-off guarantee (NO model call, narrative null).
//
// The digest module is server-only + DB-backed, so we stub `server-only`,
// `@/lib/db` (no DB → mock portfolio path) and the churn signal. The model is
// exercised via the injectable chatFn — proving brain-off makes zero calls
// WITHOUT needing to import the real model client.
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));
// No DATABASE_URL in unit env → hasDb false → digest uses the mock portfolio.
vi.mock('@/lib/db', () => ({
  hasDb: false,
  q: vi.fn(async () => []),
  q1: vi.fn(async () => null),
}));
// withTenantRls just runs the callback; churn signal is not-configured (no DB).
vi.mock('@/lib/data', () => ({
  withTenantRls: async (fn: () => any) => fn(),
  OPERATOR_IDENTITY: { tenantRef: null, isOperator: true },
}));
vi.mock('@/lib/inngest/signals/churn', () => ({
  churnSignal: vi.fn(async () => ({
    configured: false, failedInvoices: 0, windowHours: 24, threshold: 3,
    severity: 'none', tripped: false, detail: 'not configured',
  })),
}));

import {
  scoreCustomer,
  bandForScore,
  BASE_SCORE,
  type HealthSignals,
} from '@/lib/health/score';
import { assembleHealthDigest, detectUpsell } from '@/lib/health/digest';

// A quiet, fully-engaged, paying, multi-seat account.
const THRIVING: HealthSignals = {
  quotaUsedRatio: 0.9, entitlementCount: 3, openTickets: 0, recentTickets: 0,
  criticalTickets: 0, failedPayments: 0, teamSize: 10, lastActivityDays: 1,
};
// A dormant, ticket-heavy, payment-failing, single-seat account.
const CRITICAL: HealthSignals = {
  quotaUsedRatio: 0, entitlementCount: 1, openTickets: 4, recentTickets: 6,
  criticalTickets: 3, failedPayments: 3, teamSize: 1, lastActivityDays: 40,
};

describe('scoreCustomer — banding extremes', () => {
  it('scores a thriving account high and bands it thriving', () => {
    const r = scoreCustomer(THRIVING);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.band).toBe('thriving');
    expect(r.usageTrend).toBe('improving');
    expect(r.drivers.length).toBeGreaterThan(0);
    // strongest driver should be a positive one for a healthy account
    expect(r.drivers[0].kind).toBe('positive');
  });

  it('scores a failing account low and bands it critical', () => {
    const r = scoreCustomer(CRITICAL);
    expect(r.score).toBeLessThan(35);
    expect(r.band).toBe('critical');
    expect(r.usageTrend).toBe('declining');
    expect(r.openIssues).toBe(4);
    // failed-payments must appear as a negative driver
    expect(r.drivers.some((d) => d.kind === 'negative' && /failed payment/i.test(d.label))).toBe(true);
  });

  it('is deterministic (same input → same output)', () => {
    expect(scoreCustomer(THRIVING)).toEqual(scoreCustomer(THRIVING));
  });

  it('never produces a score outside 0..100', () => {
    for (const s of [THRIVING, CRITICAL]) {
      const r = scoreCustomer(s);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('bandForScore — threshold boundaries', () => {
  it('maps scores to the right band at each boundary', () => {
    expect(bandForScore(80)).toBe('thriving');
    expect(bandForScore(79)).toBe('healthy');
    expect(bandForScore(60)).toBe('healthy');
    expect(bandForScore(59)).toBe('at-risk');
    expect(bandForScore(35)).toBe('at-risk');
    expect(bandForScore(34)).toBe('critical');
    expect(bandForScore(0)).toBe('critical');
  });
});

describe('scoreCustomer — signal monotonicity', () => {
  it('failed payments strictly lower the score', () => {
    const base = { ...THRIVING, failedPayments: 0 };
    const withFail = { ...THRIVING, failedPayments: 2 };
    expect(scoreCustomer(withFail).score).toBeLessThan(scoreCustomer(base).score);
  });

  it('more usage raises the score (engagement)', () => {
    const low = scoreCustomer({ ...THRIVING, quotaUsedRatio: 0.1 }).score;
    const high = scoreCustomer({ ...THRIVING, quotaUsedRatio: 0.8 }).score;
    expect(high).toBeGreaterThan(low);
  });

  it('a fully neutral customer sits near the base score', () => {
    const neutral: HealthSignals = {
      quotaUsedRatio: null, entitlementCount: 0, openTickets: 0, recentTickets: 0,
      criticalTickets: 0, failedPayments: 0, teamSize: 0, lastActivityDays: null,
    };
    const r = scoreCustomer(neutral);
    // base 50 ± the null-signal nudges (engagement 0.3, recency 0.4) — stays mid-band.
    expect(Math.abs(r.score - BASE_SCORE)).toBeLessThan(20);
  });
});

describe('detectUpsell', () => {
  it('flags a near-quota account regardless of tier', () => {
    const c = { id: 'x', name: 'X', email: null, tier: 'Business', signals: { ...THRIVING, quotaUsedRatio: 0.85 } };
    const flag = detectUpsell(c, scoreCustomer(c.signals));
    expect(flag?.candidate).toBe(true);
    expect(flag?.reason).toMatch(/quota/i);
  });

  it('flags a thriving account on a low tier', () => {
    const c = { id: 'y', name: 'Y', email: null, tier: 'Starter', signals: { ...THRIVING, quotaUsedRatio: 0.5 } };
    const flag = detectUpsell(c, scoreCustomer(c.signals));
    expect(flag?.candidate).toBe(true);
    expect(flag?.reason).toMatch(/tier/i);
  });

  it('never flags an at-risk/critical account', () => {
    const c = { id: 'z', name: 'Z', email: null, tier: 'Starter', signals: CRITICAL };
    expect(detectUpsell(c, scoreCustomer(c.signals))).toBeNull();
  });
});

describe('assembleHealthDigest — portfolio roll-up (mock path)', () => {
  const FIXED_NOW = Date.parse('2026-07-12T12:00:00.000Z');

  beforeEach(() => {
    delete process.env.HERMES_BRAIN_ENABLED;
  });

  it('scores every mock customer and band-counts them', async () => {
    const d = await assembleHealthDigest({ now: FIXED_NOW });
    expect(d.live).toBe(false);
    expect(d.totals.customers).toBeGreaterThan(0);
    expect(d.customers.length).toBe(d.totals.customers);
    // band counts sum to the customer total
    const sum =
      d.bandCounts.thriving + d.bandCounts.healthy + d.bandCounts['at-risk'] + d.bandCounts.critical;
    expect(sum).toBe(d.totals.customers);
    // sorted worst-first
    for (let i = 1; i < d.customers.length; i++) {
      expect(d.customers[i].health.score).toBeGreaterThanOrEqual(d.customers[i - 1].health.score);
    }
  });

  it('derives the at-risk list and upsell candidates', async () => {
    const d = await assembleHealthDigest({ now: FIXED_NOW });
    // every at-risk row is genuinely at-risk|critical
    expect(d.atRisk.every((c) => c.health.band === 'at-risk' || c.health.band === 'critical')).toBe(true);
    // the curated mock spans the full spread → at least one at-risk/critical
    expect(d.atRisk.length).toBeGreaterThan(0);
    // every upsell row carries a flag and is NOT at-risk
    expect(d.upsellCandidates.every((c) => c.upsell?.candidate === true)).toBe(true);
    expect(d.upsellCandidates.every((c) => c.health.band !== 'at-risk' && c.health.band !== 'critical')).toBe(true);
    expect(d.upsellCandidates.length).toBeGreaterThan(0);
  });

  it('brain OFF → no model call and narrative is null/disabled', async () => {
    const chatSpy = vi.fn(async () => ({ ok: true, content: 'should not be called' }));
    const d = await assembleHealthDigest({ now: FIXED_NOW, chatFn: chatSpy });
    expect(chatSpy).not.toHaveBeenCalled();
    expect(d.narrative).toBeNull();
    expect(d.narrativeSource).toBe('disabled');
  });

  it('brain ON → calls the injected model and stores the narrative', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const chatSpy = vi.fn(async () => ({ ok: true, content: '  Weekly picture looks stable.  ' }));
    const d = await assembleHealthDigest({ now: FIXED_NOW, chatFn: chatSpy });
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(d.narrative).toBe('Weekly picture looks stable.');
    expect(d.narrativeSource).toBe('model');
  });

  it('brain ON but model fails → narrative null/unavailable (never throws)', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const chatSpy = vi.fn(async () => ({ ok: false, error: 'boom' }));
    const d = await assembleHealthDigest({ now: FIXED_NOW, chatFn: chatSpy });
    expect(d.narrative).toBeNull();
    expect(d.narrativeSource).toBe('unavailable');
  });
});
