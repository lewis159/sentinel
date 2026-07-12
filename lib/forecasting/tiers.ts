// Forecasting — editable tier baseline (PURE, no server-only imports so it can
// be pulled into the client calculator as well as the API route).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PLACEHOLDER NUMBERS — NEEDS BEN'S REAL FIGURES.                          │
// │ • Tier PRICES below are taken from the Scribuo 7-rung ladder             │
// │   (memory: project_scribuo_tiers.md, 2026-07-06). They are the published │
// │   list prices, not the blended realised ARPU.                           │
// │ • Tier CUSTOMER COUNTS are illustrative sample figures ONLY. Replace     │
// │   with the real per-tier active-subscription distribution.               │
// │ • Enterprise is billed annually (£3k/£6k/£12k bands) — the monthly price │
// │   here is a mid-band /12 approximation.                                   │
// │                                                                           │
// │ TODO(ben): wire the real per-tier subscriber counts + realised prices,   │
// │ ideally from the live Stripe MRR source (see lib/hermes/brain/tools/     │
// │ stripe.ts — currently a read path for individual charges only, no MRR    │
// │ aggregate endpoint yet).                                                  │
// └─────────────────────────────────────────────────────────────────────────┘

/** A single tier line: its per-customer monthly price and how many customers sit on it. */
export interface TierLine {
  /** Stable id, used by presets to target a tier (e.g. raise Starter's price). */
  id: string;
  label: string;
  /** £ per customer per month. Enterprise = annual /12 approximation. */
  price: number;
  /** Active paying customers on this tier. PLACEHOLDER — see header. */
  customers: number;
}

/**
 * Baseline tier ladder + illustrative customer distribution.
 * Prices from the Scribuo ladder; counts are placeholders.
 * `Free` (£0) is retained so the "convert free → paid" story is representable,
 * but it contributes £0 to MRR.
 */
export const BASELINE_TIERS: readonly TierLine[] = [
  { id: 'free', label: 'Free', price: 0, customers: 1200 },
  { id: 'starter', label: 'Starter', price: 9, customers: 220 },
  { id: 'pro', label: 'Pro', price: 18, customers: 140 },
  { id: 'studio', label: 'Studio', price: 29, customers: 40 },
  { id: 'business', label: 'Business', price: 69, customers: 8 },
  { id: 'reseller', label: 'Reseller', price: 199, customers: 2 },
  // Enterprise: £6k/yr mid-band ÷ 12 ≈ £500/mo. PLACEHOLDER.
  { id: 'enterprise', label: 'Enterprise', price: 500, customers: 0 },
];

/** Enterprise definition used by the "add Enterprise tier" preset. */
export const ENTERPRISE_TIER: TierLine = {
  id: 'enterprise',
  label: 'Enterprise',
  price: 500,
  customers: 3,
};

/** Sum of price × customers across a tier set = MRR contributed by paying tiers. */
export function tiersMrr(tiers: readonly TierLine[]): number {
  return tiers.reduce((sum, t) => sum + t.price * t.customers, 0);
}

/** Total customers across a tier set (includes Free). */
export function tiersCustomers(tiers: readonly TierLine[]): number {
  return tiers.reduce((sum, t) => sum + t.customers, 0);
}

/** Paying customers only (price > 0) — the base for blended ARPU. */
export function payingCustomers(tiers: readonly TierLine[]): number {
  return tiers.reduce((sum, t) => sum + (t.price > 0 ? t.customers : 0), 0);
}
