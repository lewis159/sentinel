import { describe, it, expect } from 'vitest';
import { project, type ForecastInputs } from '@/lib/forecasting/model';
import { baselineInputs, PRESETS, getPreset, runPreset } from '@/lib/forecasting/scenarios';
import { tiersMrr, payingCustomers, BASELINE_TIERS } from '@/lib/forecasting/tiers';

// ---------------------------------------------------------------------------
// Pure deterministic forecasting model. No DB, no LLM, no network. Every case
// asserts the compounding math (churn/growth/price), the runway calc (finite +
// infinite), break-even detection, and a preset's expected trajectory.
// ---------------------------------------------------------------------------

/** A minimal, hand-computable single-tier scenario so expected values are exact. */
function simple(overrides: Partial<ForecastInputs> = {}): ForecastInputs {
  return {
    tierMix: [{ id: 'pro', label: 'Pro', price: 10, customers: 100 }],
    monthlyChurnPct: 0,
    monthlyNewCustomers: 0,
    priceChangePct: 0,
    infraMonthlyCost: 0,
    cashOnHand: 0,
    months: 3,
    ...overrides,
  };
}

describe('tiers helpers', () => {
  it('derives MRR and paying customers from the mix', () => {
    const tiers = [
      { id: 'free', label: 'Free', price: 0, customers: 500 },
      { id: 'pro', label: 'Pro', price: 20, customers: 10 },
    ];
    expect(tiersMrr(tiers)).toBe(200);
    expect(payingCustomers(tiers)).toBe(10); // free excluded
  });
});

describe('baseline derivation', () => {
  it('derives baselineMrr/customers/ARPU from the tier mix', () => {
    const f = project(simple());
    expect(f.baselineMrr).toBe(1000); // 100 × £10
    expect(f.baselineCustomers).toBe(100);
    expect(f.baselineArpu).toBe(10);
    expect(f.effectiveArpu).toBe(10); // no price change
  });

  it('keeps MRR flat with no churn, no growth, no price change', () => {
    const f = project(simple({ months: 6 }));
    for (const m of f.months) {
      expect(m.mrr).toBe(1000);
      expect(m.customers).toBe(100);
      expect(m.netNew).toBe(0);
    }
    expect(f.summary.endMrr).toBe(1000);
    expect(f.summary.mrrChangePct).toBe(0);
  });
});

describe('price change', () => {
  it('applies a one-off permanent uplift to ARPU/MRR', () => {
    const f = project(simple({ priceChangePct: 20, months: 2 }));
    expect(f.effectiveArpu).toBeCloseTo(12, 6); // 10 × 1.2
    expect(f.months[0].mrr).toBeCloseTo(1200, 6);
    expect(f.months[1].mrr).toBeCloseTo(1200, 6); // permanent, not compounding month on month
    expect(f.summary.mrrChangePct).toBeCloseTo(20, 6);
  });

  it('handles a price cut', () => {
    const f = project(simple({ priceChangePct: -50 }));
    expect(f.effectiveArpu).toBeCloseTo(5, 6);
    expect(f.months[0].mrr).toBeCloseTo(500, 6);
  });
});

describe('churn compounding', () => {
  it('compounds churn on the current base each month', () => {
    // 100 customers, 10% churn, no growth: 90, 81, 73 (round), 66 (round)
    const f = project(simple({ monthlyChurnPct: 10, months: 4 }));
    expect(f.months.map((m) => m.customers)).toEqual([90, 81, 73, 66]);
    // churned per month = round(prev × 0.10)
    expect(f.months.map((m) => m.churnedCustomers)).toEqual([10, 9, 8, 7]);
    // MRR tracks customers × ARPU (£10)
    expect(f.months[3].mrr).toBe(660);
  });
});

describe('growth', () => {
  it('adds a fixed number of new customers each month (absolute)', () => {
    const f = project(simple({ monthlyNewCustomers: 5, months: 3 }));
    expect(f.months.map((m) => m.customers)).toEqual([105, 110, 115]);
    expect(f.months.map((m) => m.netNew)).toEqual([5, 5, 5]);
  });

  it('nets growth against churn correctly', () => {
    // 100, 5% churn (5), +10 new → net +5 → 105; then round(105×.05)=5 → +5 → 110
    const f = project(simple({ monthlyChurnPct: 5, monthlyNewCustomers: 10, months: 2 }));
    expect(f.months[0].churnedCustomers).toBe(5);
    expect(f.months[0].netNew).toBe(5);
    expect(f.months[0].customers).toBe(105);
    expect(f.months[1].churnedCustomers).toBe(5); // round(105×.05)=5
    expect(f.months[1].customers).toBe(110);
  });

  it('floors customers at zero when churn outpaces everything', () => {
    const f = project(simple({ customers: 4, monthlyChurnPct: 100, monthlyNewCustomers: 0, months: 2, tierMix: [{ id: 'pro', label: 'Pro', price: 10, customers: 4 }] }));
    expect(f.months[0].customers).toBe(0);
    expect(f.months[0].mrr).toBe(0);
  });
});

describe('margin + burn', () => {
  it('computes gross margin and burn against infra cost', () => {
    // MRR 1000, infra 400 → margin 600, marginPct 0.6, burn -600 (cash generative)
    const f = project(simple({ infraMonthlyCost: 400 }));
    const m = f.months[0];
    expect(m.cogs).toBe(400);
    expect(m.grossMargin).toBe(600);
    expect(m.grossMarginPct).toBeCloseTo(0.6, 6);
    expect(m.burn).toBe(-600);
  });

  it('burn is positive when infra exceeds revenue', () => {
    // 10 customers × £10 = 100 MRR, infra 500 → burn +400
    const f = project(simple({ tierMix: [{ id: 'pro', label: 'Pro', price: 10, customers: 10 }], infraMonthlyCost: 500 }));
    expect(f.months[0].burn).toBe(400);
  });
});

describe('runway', () => {
  it('is finite when burning: cashOnHand / burn', () => {
    // revenue 100, infra 500 → burn 400; cash 4000 → runway 10 months
    const f = project(simple({
      tierMix: [{ id: 'pro', label: 'Pro', price: 10, customers: 10 }],
      infraMonthlyCost: 500,
      cashOnHand: 4000,
    }));
    expect(f.months[0].runwayMonths).toBeCloseTo(10, 6);
    expect(f.summary.runwayMonths).toBeCloseTo(10, 6);
  });

  it('is Infinity when cash-generative (burn <= 0)', () => {
    const f = project(simple({ infraMonthlyCost: 100, cashOnHand: 5000 })); // revenue 1000 > 100
    expect(f.months[0].runwayMonths).toBe(Infinity);
    expect(f.summary.runwayMonths).toBe(Infinity);
  });

  it('tracks a running cash balance that depletes while burning', () => {
    const f = project(simple({
      tierMix: [{ id: 'pro', label: 'Pro', price: 10, customers: 10 }],
      infraMonthlyCost: 500, // burn 400/mo
      cashOnHand: 1000,
      months: 4,
    }));
    expect(f.months.map((m) => m.cash)).toEqual([600, 200, -200, -600]);
    expect(f.summary.cashDepletedMonth).toBe(3); // first month cash < 0
  });
});

describe('break-even detection', () => {
  it('detects the first month revenue covers infra as growth closes the gap', () => {
    // Start 10 cust (£100), infra 250, +10 new/mo, no churn.
    // Mo1: 20 cust £200 burn 50. Mo2: 30 cust £300 burn -50 → break-even mo2.
    const f = project(simple({
      tierMix: [{ id: 'pro', label: 'Pro', price: 10, customers: 10 }],
      monthlyNewCustomers: 10,
      infraMonthlyCost: 250,
      months: 4,
    }));
    expect(f.months[0].burn).toBe(50);
    expect(f.months[1].burn).toBe(-50);
    expect(f.summary.breakEvenMonth).toBe(2);
  });

  it('reports null break-even when never profitable in the horizon', () => {
    const f = project(simple({
      tierMix: [{ id: 'pro', label: 'Pro', price: 10, customers: 10 }],
      infraMonthlyCost: 10000,
      months: 6,
    }));
    expect(f.summary.breakEvenMonth).toBeNull();
  });
});

describe('input safety', () => {
  it('coerces a zero-length horizon up to at least one month', () => {
    const f = project(simple({ months: 0 }));
    expect(f.months.length).toBe(1);
  });

  it('does not throw on non-finite / negative inputs', () => {
    expect(() =>
      project(simple({ monthlyChurnPct: NaN, monthlyNewCustomers: -5, cashOnHand: -100 })),
    ).not.toThrow();
  });
});

describe('scenario presets', () => {
  it('baseline preset leaves the default inputs unchanged', () => {
    const base = baselineInputs();
    const out = runPreset('baseline');
    expect(tiersMrr(out.tierMix)).toBe(tiersMrr(base.tierMix));
    expect(out.monthlyChurnPct).toBe(base.monthlyChurnPct);
  });

  it('"raise Starter 20%" lifts only the Starter price and raises MRR', () => {
    const base = baselineInputs();
    const out = runPreset('raise-starter-20');
    const baseStarter = base.tierMix.find((t) => t.id === 'starter')!;
    const outStarter = out.tierMix.find((t) => t.id === 'starter')!;
    expect(outStarter.price).toBeCloseTo(baseStarter.price * 1.2, 6);
    // other tiers untouched
    const basePro = base.tierMix.find((t) => t.id === 'pro')!;
    const outPro = out.tierMix.find((t) => t.id === 'pro')!;
    expect(outPro.price).toBe(basePro.price);
    // MRR rises by exactly the Starter delta
    const delta = (outStarter.price - baseStarter.price) * baseStarter.customers;
    expect(tiersMrr(out.tierMix)).toBeCloseTo(tiersMrr(base.tierMix) + delta, 4);
  });

  it('"churn spike +5pts" adds 5 percentage points to churn and lowers end MRR', () => {
    const base = baselineInputs();
    const out = runPreset('churn-spike-5');
    expect(out.monthlyChurnPct).toBe(base.monthlyChurnPct + 5);
    const before = project(base).summary.endMrr;
    const after = project(out).summary.endMrr;
    expect(after).toBeLessThan(before);
  });

  it('"add Enterprise tier" lands Enterprise customers and grows MRR', () => {
    const base = baselineInputs();
    const out = runPreset('add-enterprise');
    const ent = out.tierMix.find((t) => t.id === 'enterprise')!;
    expect(ent.customers).toBeGreaterThan(0);
    expect(tiersMrr(out.tierMix)).toBeGreaterThan(tiersMrr(base.tierMix));
  });

  it('"infra cost +30%" raises infra and shortens runway (higher burn or worse margin)', () => {
    const base = baselineInputs();
    const out = runPreset('infra-plus-30');
    expect(out.infraMonthlyCost).toBe(Math.round(base.infraMonthlyCost * 1.3));
  });

  it('every preset is pure — applying it does not mutate the baseline', () => {
    const base = baselineInputs();
    const snapshot = JSON.stringify(base);
    for (const p of PRESETS) p.apply(base);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('getPreset returns undefined for an unknown id', () => {
    expect(getPreset('nope')).toBeUndefined();
  });
});

describe('full baseline scenario sanity', () => {
  it('projects the default baseline without error and returns a 12-month series', () => {
    const f = project(baselineInputs());
    expect(f.months.length).toBe(12);
    expect(f.baselineMrr).toBe(tiersMrr(BASELINE_TIERS));
    expect(Number.isFinite(f.summary.totalRevenue)).toBe(true);
  });
});
