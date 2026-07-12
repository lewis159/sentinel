// Forecasting — scenario presets + the default baseline inputs (PURE).
//
// A preset is a named transform over a base set of inputs. The UI starts from
// `baselineInputs()` and either edits fields freely (custom) or clicks a preset
// to jump to a canned what-if. Presets are deterministic pure functions so they
// can run client-side and in the API route identically.

import { BASELINE_TIERS, ENTERPRISE_TIER, type TierLine } from './tiers';
import type { ForecastInputs } from './model';

/**
 * The default baseline scenario.
 *
 * ┌─ PLACEHOLDER NUMBERS — NEEDS BEN'S REAL FIGURES ─────────────────────────┐
 * │ tierMix counts/prices  → see lib/forecasting/tiers.ts                     │
 * │ monthlyChurnPct 3.5    → assumed monthly logo churn; replace with actual  │
 * │ monthlyNewCustomers 25 → assumed net-new/mo; replace with actual          │
 * │ infraMonthlyCost 1800  → assumed £/mo infra+COGS; replace with actual     │
 * │ cashOnHand 60000       → assumed cash reserve; replace with actual        │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function baselineInputs(): ForecastInputs {
  return {
    tierMix: BASELINE_TIERS.map((t) => ({ ...t })),
    monthlyChurnPct: 3.5,
    monthlyNewCustomers: 25,
    priceChangePct: 0,
    infraMonthlyCost: 1800,
    cashOnHand: 60000,
    months: 12,
  };
}

/** Deep-ish clone so a preset never mutates the caller's inputs. */
function clone(inp: ForecastInputs): ForecastInputs {
  return { ...inp, tierMix: inp.tierMix.map((t) => ({ ...t })) };
}

/** Multiply a single tier's price in-place on a cloned input set. */
function raiseTierPrice(inp: ForecastInputs, tierId: string, mul: number): ForecastInputs {
  const next = clone(inp);
  next.tierMix = next.tierMix.map((t) =>
    t.id === tierId ? { ...t, price: Math.round(t.price * mul * 100) / 100 } : t,
  );
  return next;
}

export interface ScenarioPreset {
  id: string;
  label: string;
  /** Short human explanation of what the preset changes. */
  description: string;
  /** Pure transform: base inputs → scenario inputs. */
  apply: (base: ForecastInputs) => ForecastInputs;
}

export const PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'baseline',
    label: 'Baseline',
    description: 'Current trajectory — no changes.',
    apply: (base) => clone(base),
  },
  {
    id: 'raise-starter-20',
    label: 'Raise Starter 20%',
    description: 'Increase the Starter tier price by 20% (mix unchanged).',
    apply: (base) => raiseTierPrice(base, 'starter', 1.2),
  },
  {
    id: 'price-rise-10',
    label: 'Across-the-board +10%',
    description: 'Apply a one-off +10% price rise to every paying customer.',
    apply: (base) => ({ ...clone(base), priceChangePct: base.priceChangePct + 10 }),
  },
  {
    id: 'churn-spike-5',
    label: 'Churn spike +5pts',
    description: 'Monthly churn jumps by 5 percentage points (e.g. a bad release).',
    apply: (base) => ({ ...clone(base), monthlyChurnPct: base.monthlyChurnPct + 5 }),
  },
  {
    id: 'add-enterprise',
    label: 'Add Enterprise tier',
    description: 'Land 3 Enterprise accounts (£500/mo each, annually billed).',
    apply: (base) => {
      const next = clone(base);
      const has = next.tierMix.some((t) => t.id === ENTERPRISE_TIER.id);
      next.tierMix = has
        ? next.tierMix.map((t) =>
            t.id === ENTERPRISE_TIER.id
              ? { ...t, price: ENTERPRISE_TIER.price, customers: t.customers + ENTERPRISE_TIER.customers }
              : t,
          )
        : [...next.tierMix, { ...ENTERPRISE_TIER }];
      return next;
    },
  },
  {
    id: 'infra-plus-30',
    label: 'Infra cost +30%',
    description: 'Infra / COGS rises 30% (scale-up or price change from a provider).',
    apply: (base) => ({
      ...clone(base),
      infraMonthlyCost: Math.round(base.infraMonthlyCost * 1.3),
    }),
  },
];

/** Look up a preset by id. */
export function getPreset(id: string): ScenarioPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Apply a preset id to the default baseline (convenience for the API/UI). */
export function runPreset(id: string, base = baselineInputs()): ForecastInputs {
  const preset = getPreset(id);
  return preset ? preset.apply(base) : clone(base);
}

export type { TierLine };
