// Forecasting API — GET baseline + presets, POST run a scenario.
//
//   GET  /api/v2/admin/forecasting
//        → { inputs, presets, projection, placeholders } for the default baseline.
//   POST /api/v2/admin/forecasting
//        body { inputs?, presetId?, withNarrative? }
//        → { inputs, projection, narrative } for the requested scenario.
//
// READ-ONLY / ADVISORY. The projection is pure deterministic math (lib/
// forecasting/model.ts). The optional narrative (lib/forecasting/narrative.ts)
// only INTERPRETS the computed series and is gated behind HERMES_BRAIN_ENABLED —
// when the Brain is off it degrades to { enabled:false } and the numbers stand.
// No side effects, no DB writes, no schema change. Mock-safe.
//
// Gating: the Forecasting surface lives under Hermes (nav + page), so both the
// page and this route gate on the `hermes` section. (The /admin path segment is
// just where the admin-facing v2 APIs are grouped; global_admin has every section.)
import { NextResponse } from 'next/server';
import { requireSectionApi } from '@/lib/auth';
import { project, type ForecastInputs } from '@/lib/forecasting/model';
import { baselineInputs, PRESETS, getPreset } from '@/lib/forecasting/scenarios';
import { generateNarrative } from '@/lib/forecasting/narrative';
import type { TierLine } from '@/lib/forecasting/tiers';

export const dynamic = 'force-dynamic';

const PLACEHOLDER_NOTE =
  'Baseline tier prices come from the Scribuo ladder; customer counts, churn, ' +
  'new-customer rate, infra cost and cash-on-hand are PLACEHOLDERS pending Ben’s ' +
  'real figures (no live Stripe MRR source wired yet).';

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Coerce an arbitrary JSON tierMix into safe TierLine[]. */
function coerceTierMix(raw: unknown, fallback: readonly TierLine[]): TierLine[] {
  if (!Array.isArray(raw)) return fallback.map((t) => ({ ...t }));
  const out: TierLine[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    if (typeof o.id !== 'string') continue;
    out.push({
      id: o.id,
      label: typeof o.label === 'string' ? o.label : o.id,
      price: Math.max(0, num(o.price, 0)),
      customers: Math.max(0, Math.round(num(o.customers, 0))),
    });
  }
  return out.length ? out : fallback.map((t) => ({ ...t }));
}

/** Coerce an arbitrary JSON body into a safe ForecastInputs. */
function coerceInputs(raw: unknown): ForecastInputs {
  const base = baselineInputs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  return {
    tierMix: coerceTierMix(o.tierMix, base.tierMix),
    baselineMrr: typeof o.baselineMrr === 'number' ? o.baselineMrr : undefined,
    customers: typeof o.customers === 'number' ? o.customers : undefined,
    monthlyChurnPct: num(o.monthlyChurnPct, base.monthlyChurnPct),
    monthlyNewCustomers: num(o.monthlyNewCustomers, base.monthlyNewCustomers),
    priceChangePct: num(o.priceChangePct, base.priceChangePct),
    infraMonthlyCost: num(o.infraMonthlyCost, base.infraMonthlyCost),
    cashOnHand: num(o.cashOnHand, base.cashOnHand),
    months: Math.max(1, Math.min(120, Math.round(num(o.months, base.months)))),
  };
}

/** Preset metadata safe to serialise (drops the function). */
const presetMeta = PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description }));

export async function GET() {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  const inputs = baselineInputs();
  return NextResponse.json({
    inputs,
    presets: presetMeta,
    projection: project(inputs),
    placeholders: PLACEHOLDER_NOTE,
  });
}

export async function POST(req: Request) {
  const denied = await requireSectionApi('hermes');
  if (denied) return denied;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // Resolve inputs: an explicit `inputs` object wins; else apply a preset id to
  // the default baseline; else the baseline itself.
  let inputs: ForecastInputs;
  let scenarioLabel = 'Custom scenario';
  if (body?.inputs) {
    inputs = coerceInputs(body.inputs);
    if (typeof body?.scenarioLabel === 'string' && body.scenarioLabel.trim()) {
      scenarioLabel = body.scenarioLabel.trim();
    }
  } else if (typeof body?.presetId === 'string') {
    const preset = getPreset(body.presetId);
    inputs = preset ? preset.apply(baselineInputs()) : baselineInputs();
    scenarioLabel = preset ? preset.label : 'Baseline';
  } else {
    inputs = baselineInputs();
    scenarioLabel = 'Baseline';
  }

  const projection = project(inputs);

  const narrative =
    body?.withNarrative === true
      ? await generateNarrative(projection, scenarioLabel)
      : { enabled: false as const };

  return NextResponse.json({ inputs, scenarioLabel, projection, narrative });
}
