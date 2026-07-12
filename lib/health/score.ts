// Customer-health scorer (Sentinel · Hermes console).
//
// PURE + MOCK-SAFE: this module has NO imports — no DB, no model, no server-only.
// It takes a bag of already-gathered signals for ONE customer and returns a
// deterministic 0-100 health score, a band, and the human-readable drivers behind
// it. The same inputs always yield the same output (no clock, no randomness), so
// it is trivially unit-testable and safe to run anywhere.
//
// WHAT SIGNALS ARE REAL vs NOT (be honest — see lib/health/digest.ts for wiring):
//   * quotaUsedRatio / entitlementCount → REAL, read-through from ops.app_entitlements
//     (YT tier/quota mirror). This is our best "is the customer actually using the
//     product" telemetry today. There is NO event-level product-usage stream.
//   * openTickets / recentTickets / criticalTickets → REAL, from ops.tickets.
//   * teamSize → REAL, from ops.org_members.
//   * lastActivityDays → PROXY: derived from the most recent ticket/entitlement
//     activity we can see, NOT from a real "last login / last transcript" event.
//   * failedPayments → PROXY: the dunning failed-payment count (see
//     lib/inngest/signals/churn.ts). NOT attributable per-customer today (the
//     dunning proposals are keyed by invoice, not tenant), so in the live path it
//     stays 0 per-customer and the portfolio churn signal is surfaced separately.
//     The weight is kept here so the model is ready the moment a real
//     subscription-events source lands.

export type HealthBand = 'thriving' | 'healthy' | 'at-risk' | 'critical';

// The raw, pre-scored signals for one customer. Every field is nullable/absent-safe:
// a missing signal degrades to a neutral contribution, never a throw.
export type HealthSignals = {
  /** used / limit for the customer's primary entitlement. null = not synced/dormant-unknown. */
  quotaUsedRatio: number | null;
  /** distinct apps/entitlements synced — breadth of adoption (stickiness). */
  entitlementCount: number;
  /** open (non-terminal) tickets right now. */
  openTickets: number;
  /** tickets opened within the recency window (default 30d) — support burden. */
  recentTickets: number;
  /** open tickets at critical/high priority — acute dissatisfaction. */
  criticalTickets: number;
  /** failed payments in the churn window (proxy; see note above). */
  failedPayments: number;
  /** org member count — bigger teams are stickier. */
  teamSize: number;
  /** days since the most recent visible activity. null = unknown. */
  lastActivityDays: number | null;
};

export type HealthDriver = {
  label: string;
  kind: 'positive' | 'negative';
  /** signed point contribution to the score (for transparency in the UI). */
  points: number;
};

export type HealthScore = {
  score: number; // 0-100, integer
  band: HealthBand;
  drivers: HealthDriver[]; // strongest contributors first (by |points|)
  usageTrend: 'improving' | 'steady' | 'declining' | 'unknown';
  openIssues: number;
  lastActivityDays: number | null;
  /** per-signal point breakdown (base excluded) — audit trail for the score. */
  components: {
    engagement: number;
    breadth: number;
    team: number;
    ticketLoad: number;
    severity: number;
    payments: number;
    recency: number;
  };
};

// --- Model constants (documented, deterministic) ---------------------------
// Score = BASE + Σ(weight × subscore). Positive weights reward health; negative
// weights are risk penalties. Every subscore is normalised to 0..1 so the weight
// IS the maximum points that signal can move the score. Tuned so a fully engaged,
// quiet, paying, multi-seat account lands ~100 and a dormant, ticket-heavy,
// payment-failing one lands ~0.
export const BASE_SCORE = 50;

export const WEIGHTS = {
  engagement: 22, // product usage / quota utilisation
  breadth: 8, // number of apps adopted
  team: 10, // team size (stickiness)
  ticketLoad: -20, // recent ticket volume (support burden)
  severity: -18, // open critical/high tickets (acute pain)
  payments: -28, // failed payments (strongest churn signal)
  recency: 16, // freshness of activity
} as const;

// Band thresholds (inclusive lower bound). Ordered high → low.
export const BAND_THRESHOLDS: { band: HealthBand; min: number }[] = [
  { band: 'thriving', min: 80 },
  { band: 'healthy', min: 60 },
  { band: 'at-risk', min: 35 },
  { band: 'critical', min: 0 },
];

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function bandForScore(score: number): HealthBand {
  for (const t of BAND_THRESHOLDS) {
    if (score >= t.min) return t.band;
  }
  return 'critical';
}

// --- Subscore functions (each returns 0..1) --------------------------------

// Engagement rises monotonically with utilisation and plateaus at ~80% of quota.
// A dormant account (ratio 0) scores 0; an unsynced one (null) gets a mild 0.3 so
// "we can't see usage" isn't punished as hard as "signed up and never used it".
function engagementSub(ratio: number | null): number {
  if (ratio == null) return 0.3;
  return clamp01(ratio / 0.8);
}
// Breadth: 3+ apps adopted = fully sticky.
function breadthSub(count: number): number {
  return clamp01(count / 3);
}
// Team: 8+ seats = fully sticky.
function teamSub(size: number): number {
  return clamp01(size / 8);
}
// Ticket load (risk): 6+ recent tickets = full burden.
function ticketLoadSub(recent: number): number {
  return clamp01(recent / 6);
}
// Severity (risk): 3+ open crit/high = full acute pain.
function severitySub(crit: number): number {
  return clamp01(crit / 3);
}
// Payments (risk): 3+ failed payments = full churn signal. Any failure hurts.
function paymentsSub(failed: number): number {
  return clamp01(failed / 3);
}
// Recency: fresh (0d) = 1, decays linearly to 0 at 30 days. Unknown = 0.4.
function recencySub(days: number | null): number {
  if (days == null) return 0.4;
  return clamp01(1 - days / 30);
}

// --- Trend (coarse PROXY — no historical series exists) --------------------
// We have NO time-series of past scores, so a true week-over-week trend is not
// derivable. This is a defensible SNAPSHOT proxy: acute risk signals imply a
// declining trajectory; strong-engagement-with-no-pain implies improving.
// Documented as a proxy in the UI. Replace with real deltas once score history
// is persisted.
function deriveTrend(s: HealthSignals): HealthScore['usageTrend'] {
  if (s.failedPayments > 0 || s.criticalTickets > 0 || s.recentTickets >= 4) {
    return 'declining';
  }
  const engaged = (s.quotaUsedRatio ?? 0) >= 0.5;
  const fresh = s.lastActivityDays != null && s.lastActivityDays <= 7;
  if (engaged && fresh && s.openTickets === 0) return 'improving';
  if (s.quotaUsedRatio == null && s.lastActivityDays == null) return 'unknown';
  return 'steady';
}

// --- Driver labels ---------------------------------------------------------

function pushDriver(
  out: HealthDriver[],
  label: string,
  kind: HealthDriver['kind'],
  points: number,
) {
  // Only surface contributions that actually moved the needle.
  if (Math.abs(points) < 0.5) return;
  out.push({ label, kind, points: Math.round(points * 10) / 10 });
}

/**
 * Score one customer's health from its signals. Pure + deterministic.
 */
export function scoreCustomer(signals: HealthSignals): HealthScore {
  const s: HealthSignals = {
    quotaUsedRatio: signals.quotaUsedRatio ?? null,
    entitlementCount: Math.max(0, signals.entitlementCount || 0),
    openTickets: Math.max(0, signals.openTickets || 0),
    recentTickets: Math.max(0, signals.recentTickets || 0),
    criticalTickets: Math.max(0, signals.criticalTickets || 0),
    failedPayments: Math.max(0, signals.failedPayments || 0),
    teamSize: Math.max(0, signals.teamSize || 0),
    lastActivityDays: signals.lastActivityDays ?? null,
  };

  const components = {
    engagement: WEIGHTS.engagement * engagementSub(s.quotaUsedRatio),
    breadth: WEIGHTS.breadth * breadthSub(s.entitlementCount),
    team: WEIGHTS.team * teamSub(s.teamSize),
    ticketLoad: WEIGHTS.ticketLoad * ticketLoadSub(s.recentTickets),
    severity: WEIGHTS.severity * severitySub(s.criticalTickets),
    payments: WEIGHTS.payments * paymentsSub(s.failedPayments),
    recency: WEIGHTS.recency * recencySub(s.lastActivityDays),
  };

  const raw =
    BASE_SCORE +
    components.engagement +
    components.breadth +
    components.team +
    components.ticketLoad +
    components.severity +
    components.payments +
    components.recency;

  const score = Math.round(Math.min(100, Math.max(0, raw)));
  const band = bandForScore(score);

  // Build human-readable drivers from the signed components.
  const drivers: HealthDriver[] = [];
  if (s.quotaUsedRatio != null) {
    const pct = Math.round(s.quotaUsedRatio * 100);
    pushDriver(
      drivers,
      s.quotaUsedRatio >= 0.8
        ? `Heavy product usage (${pct}% of quota)`
        : s.quotaUsedRatio <= 0.1
          ? `Barely using the product (${pct}% of quota)`
          : `Product usage at ${pct}% of quota`,
      s.quotaUsedRatio >= 0.4 ? 'positive' : 'negative',
      components.engagement - WEIGHTS.engagement * 0.5, // relative to a neutral 0.5
    );
  } else {
    pushDriver(drivers, 'Usage not synced (dormant-unknown)', 'negative', -4);
  }
  pushDriver(
    drivers,
    `${s.entitlementCount} app${s.entitlementCount === 1 ? '' : 's'} adopted`,
    s.entitlementCount >= 2 ? 'positive' : 'negative',
    components.breadth - WEIGHTS.breadth * 0.5,
  );
  pushDriver(
    drivers,
    `${s.teamSize} team member${s.teamSize === 1 ? '' : 's'}`,
    s.teamSize >= 3 ? 'positive' : 'negative',
    components.team - WEIGHTS.team * 0.4,
  );
  pushDriver(
    drivers,
    `${s.recentTickets} recent ticket${s.recentTickets === 1 ? '' : 's'}`,
    'negative',
    components.ticketLoad,
  );
  pushDriver(
    drivers,
    `${s.criticalTickets} open critical/high issue${s.criticalTickets === 1 ? '' : 's'}`,
    'negative',
    components.severity,
  );
  pushDriver(
    drivers,
    `${s.failedPayments} failed payment${s.failedPayments === 1 ? '' : 's'}`,
    'negative',
    components.payments,
  );
  if (s.lastActivityDays != null) {
    pushDriver(
      drivers,
      s.lastActivityDays <= 7
        ? `Active in the last ${s.lastActivityDays}d`
        : `No activity for ${s.lastActivityDays}d`,
      s.lastActivityDays <= 14 ? 'positive' : 'negative',
      components.recency - WEIGHTS.recency * 0.4,
    );
  }

  // Strongest movers first.
  drivers.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));

  return {
    score,
    band,
    drivers,
    usageTrend: deriveTrend(s),
    openIssues: s.openTickets,
    lastActivityDays: s.lastActivityDays,
    components: {
      engagement: round1(components.engagement),
      breadth: round1(components.breadth),
      team: round1(components.team),
      ticketLoad: round1(components.ticketLoad),
      severity: round1(components.severity),
      payments: round1(components.payments),
      recency: round1(components.recency),
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const BAND_LABEL: Record<HealthBand, string> = {
  thriving: 'Thriving',
  healthy: 'Healthy',
  'at-risk': 'At risk',
  critical: 'Critical',
};

// Map a band → an existing v2 pill/tile CSS variant so the UI reuses the design
// tokens (no new colour system): thriving/healthy = ok/sky, at-risk = high,
// critical = crit.
export const BAND_PILL: Record<HealthBand, string> = {
  thriving: 'ok',
  healthy: 'sky',
  'at-risk': 'high',
  critical: 'crit',
};
