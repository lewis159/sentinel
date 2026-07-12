// Forecasting — the deterministic projection engine (PURE, fully unit-tested).
//
// This is the core value of the feature: given a set of business inputs it
// projects MRR / revenue / customers / margin / burn / runway month by month.
// There is NO randomness and NO LLM here — the numbers are reproducible. The
// optional Hermes narrative (lib/forecasting/narrative.ts) only INTERPRETS the
// series this module produces; it never changes a number.
//
// No `server-only` import: safe to run in the browser (the calculator computes
// live client-side) AND on the server (the API route).
//
// ── Model semantics ────────────────────────────────────────────────────────
// The business is a subscription: monthly revenue == MRR. Each month:
//   churned   = round(customers_prev × monthlyChurnPct%)        (compounds on base)
//   added     = monthlyNewCustomers                              (fixed absolute add)
//   customers = customers_prev − churned + added   (floored at 0)
//   mrr       = customers × arpu
// where `arpu` (blended average revenue per paying customer) is constant across
// the horizon EXCEPT for a one-off permanent price change applied up-front:
//   arpu = baselineArpu × (1 + priceChangePct/100)
// Targeted price moves (e.g. "raise Starter 20%") are expressed by editing the
// tier mix itself (which raises baselineMrr/ARPU) — see lib/forecasting/scenarios.ts.
//
// Cost side (single modelled cost = infra/COGS):
//   cogs        = infraMonthlyCost
//   grossMargin = revenue − cogs            (£)
//   burn        = cogs − revenue            (>0 ⇒ burning cash)
//   runwayMonths = burn > 0 ? cashOnHand / burn : Infinity   (per the spec)
// A running `cash` balance is also tracked (cash − burn each month; a
// cash-generative month grows it) so the UI can show a cash curve / depletion.

import { BASELINE_TIERS, tiersMrr, payingCustomers, type TierLine } from './tiers';

/** Inputs to a projection. `tierMix` is the source of truth for MRR + customers;
 *  `baselineMrr`/`customers` may override the derived values (rare — kept for the
 *  spec's signature + when a raw MRR figure is supplied without a tier breakdown). */
export interface ForecastInputs {
  /** Per-tier price + customer counts. Drives baselineMrr, customers and blended ARPU. */
  tierMix: readonly TierLine[];
  /** Optional explicit starting MRR (£/mo). Defaults to Σ(price×customers) of tierMix. */
  baselineMrr?: number;
  /** Optional explicit starting PAYING customers. Defaults to paying customers of tierMix. */
  customers?: number;
  /** % of customers lost each month (compounds on the current base). */
  monthlyChurnPct: number;
  /** Gross new customers added each month (absolute). */
  monthlyNewCustomers: number;
  /** One-off permanent price change applied to ARPU (e.g. +20 ⇒ +20%). */
  priceChangePct: number;
  /** Infra / COGS per month (£). The single modelled cost. */
  infraMonthlyCost: number;
  /** Cash reserve (£) used for the runway calculation. */
  cashOnHand: number;
  /** Projection horizon in months (≥ 1). */
  months: number;
}

/** One projected month. `runwayMonths` is Infinity when the month is not burning cash. */
export interface MonthProjection {
  /** 1-based month index. */
  month: number;
  customers: number;
  churnedCustomers: number;
  /** added − churned (may be negative when churn outpaces growth). */
  netNew: number;
  /** Blended average revenue per paying customer (£/mo) — constant post price change. */
  arpu: number;
  mrr: number;
  /** Monthly recognised revenue = mrr for a subscription. */
  revenue: number;
  /** Cost of goods sold this month = infraMonthlyCost. */
  cogs: number;
  /** revenue − cogs (£). */
  grossMargin: number;
  /** grossMargin / revenue (0 when revenue is 0). */
  grossMarginPct: number;
  /** cogs − revenue (>0 ⇒ burning cash). */
  burn: number;
  /** Running cash balance after this month (cash_prev − burn). */
  cash: number;
  /** cashOnHand / burn when burn>0, else Infinity. */
  runwayMonths: number;
}

/** The full result: the per-month series plus headline summary numbers. */
export interface Forecast {
  baselineMrr: number;
  baselineCustomers: number;
  baselineArpu: number;
  /** ARPU after the one-off price change (what every projected month uses). */
  effectiveArpu: number;
  months: MonthProjection[];
  summary: ForecastSummary;
}

export interface ForecastSummary {
  /** MRR in the final projected month. */
  endMrr: number;
  /** Paying customers in the final projected month. */
  endCustomers: number;
  /** endMrr / baselineMrr − 1, as a %. 0 when baseline is 0. */
  mrrChangePct: number;
  /** Total revenue summed across the horizon. */
  totalRevenue: number;
  /** Gross margin in the final month (£). */
  endGrossMargin: number;
  /** Runway at the CURRENT (month-1) burn rate. Infinity when not burning. */
  runwayMonths: number;
  /** First month the business stops burning cash (burn ≤ 0), else null. */
  breakEvenMonth: number | null;
  /** First month the running cash balance goes negative, else null. */
  cashDepletedMonth: number | null;
}

const round = (n: number) => Math.round(n);
/** Clamp a percentage-ish rate into a sane, finite number. */
const num = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);

/**
 * Project a business forward `months` months. Pure + deterministic.
 * Throws nothing — bad inputs are coerced to safe defaults.
 */
export function project(inputs: ForecastInputs): Forecast {
  const tierMix = inputs.tierMix?.length ? inputs.tierMix : BASELINE_TIERS;

  const baselineMrr = num(inputs.baselineMrr ?? tiersMrr(tierMix));
  const baselineCustomers = Math.max(
    0,
    round(num(inputs.customers ?? payingCustomers(tierMix))),
  );
  const baselineArpu = baselineCustomers > 0 ? baselineMrr / baselineCustomers : 0;

  const churn = Math.max(0, num(inputs.monthlyChurnPct)) / 100;
  const added = Math.max(0, round(num(inputs.monthlyNewCustomers)));
  const priceMul = 1 + num(inputs.priceChangePct) / 100;
  const effectiveArpu = baselineArpu * priceMul;
  const cogs = Math.max(0, num(inputs.infraMonthlyCost));
  const cashOnHand = Math.max(0, num(inputs.cashOnHand));
  const horizon = Math.max(1, Math.floor(num(inputs.months, 1)));

  const months: MonthProjection[] = [];
  let customers = baselineCustomers;
  let cash = cashOnHand;
  let breakEvenMonth: number | null = null;
  let cashDepletedMonth: number | null = null;
  let totalRevenue = 0;

  for (let m = 1; m <= horizon; m++) {
    const churned = round(customers * churn);
    const netNew = added - churned;
    customers = Math.max(0, customers - churned + added);

    const mrr = customers * effectiveArpu;
    const revenue = mrr;
    const grossMargin = revenue - cogs;
    const grossMarginPct = revenue > 0 ? grossMargin / revenue : 0;
    const burn = cogs - revenue;
    cash = cash - burn; // a cash-generative month (burn<0) grows the balance

    const runwayMonths = burn > 0 ? cashOnHand / burn : Infinity;

    if (breakEvenMonth === null && burn <= 0) breakEvenMonth = m;
    if (cashDepletedMonth === null && cash < 0) cashDepletedMonth = m;
    totalRevenue += revenue;

    months.push({
      month: m,
      customers,
      churnedCustomers: churned,
      netNew,
      arpu: effectiveArpu,
      mrr,
      revenue,
      cogs,
      grossMargin,
      grossMarginPct,
      burn,
      cash,
      runwayMonths,
    });
  }

  const last = months[months.length - 1];
  const firstBurn = months[0].burn;
  const summary: ForecastSummary = {
    endMrr: last.mrr,
    endCustomers: last.customers,
    mrrChangePct: baselineMrr > 0 ? (last.mrr / baselineMrr - 1) * 100 : 0,
    totalRevenue,
    endGrossMargin: last.grossMargin,
    runwayMonths: firstBurn > 0 ? cashOnHand / firstBurn : Infinity,
    breakEvenMonth,
    cashDepletedMonth,
  };

  return { baselineMrr, baselineCustomers, baselineArpu, effectiveArpu, months, summary };
}
