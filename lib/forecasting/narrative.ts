// Forecasting — optional Hermes narrative (server-only).
//
// ADVISORY ONLY. This turns a COMPUTED projection into a short prose "what this
// means" read-out. It is handed the finished numbers and asked to INTERPRET
// them — it is explicitly told not to (and structurally cannot) change any
// figure. Gated behind brainEnabled(): when the Brain is off, or the model call
// fails, or no API key is configured, the API degrades to `{ enabled: false }`
// and the deterministic numbers stand alone.
import 'server-only';
import { brainEnabled } from '@/lib/hermes/brain/flags';
import { callModel } from '@/lib/hermes/brain/model';
import type { Forecast } from './model';

export interface NarrativeResult {
  enabled: boolean;
  /** Present only when enabled && the model returned prose. */
  text?: string;
  /** Present when enabled but generation failed (surfaced quietly in the UI). */
  error?: string;
  model?: string;
}

/** Round for a compact prompt — the model reasons over rounded figures, fine for prose. */
const gbp = (n: number) => (Number.isFinite(n) ? Math.round(n) : n);

/**
 * Compact the finished forecast into the few facts the model needs, so the
 * prompt is small and the model can't invent a different trajectory.
 */
function digest(f: Forecast, scenarioLabel: string): string {
  const s = f.summary;
  const runway = Number.isFinite(s.runwayMonths)
    ? `${s.runwayMonths.toFixed(1)} months`
    : 'infinite (cash-generative)';
  const be = s.breakEvenMonth ? `month ${s.breakEvenMonth}` : 'not within the horizon';
  const depleted = s.cashDepletedMonth ? `month ${s.cashDepletedMonth}` : 'not within the horizon';
  const first = f.months[0];
  const last = f.months[f.months.length - 1];
  return [
    `Scenario: ${scenarioLabel}`,
    `Horizon: ${f.months.length} months`,
    `Baseline MRR: £${gbp(f.baselineMrr)} across ${f.baselineCustomers} paying customers (ARPU £${gbp(f.baselineArpu)}).`,
    `Effective ARPU after price change: £${gbp(f.effectiveArpu)}.`,
    `End MRR: £${gbp(s.endMrr)} (${s.mrrChangePct >= 0 ? '+' : ''}${s.mrrChangePct.toFixed(1)}% vs baseline), ${s.endCustomers} customers.`,
    `Total revenue over horizon: £${gbp(s.totalRevenue)}.`,
    `Month 1 burn: £${gbp(first.burn)}/mo; month ${last.month} burn: £${gbp(last.burn)}/mo.`,
    `Runway at current burn: ${runway}. Break-even: ${be}. Cash depleted: ${depleted}.`,
  ].join('\n');
}

/**
 * Generate an advisory narrative for a projection. Returns `{ enabled:false }`
 * when the Brain is disabled — the caller MUST render the numbers regardless.
 */
export async function generateNarrative(
  forecast: Forecast,
  scenarioLabel: string,
): Promise<NarrativeResult> {
  if (!brainEnabled()) return { enabled: false };

  const system =
    'You are the Hermes CFO copilot. You are given a FINISHED, deterministic ' +
    'financial projection. Interpret it for the founder in plain British English: ' +
    'what the trajectory means, the key risk or opportunity, and one thing to watch. ' +
    'Rules: (1) NEVER restate every number — reference at most 3-4. (2) NEVER invent, ' +
    'recompute or contradict any figure; the numbers are fixed. (3) Be advisory, not ' +
    'directive — no actions are taken here. (4) 3-5 sentences, no headings, no lists.';

  try {
    const res = await callModel({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: digest(forecast, scenarioLabel) },
      ],
      temperature: 0.4,
      maxTokens: 400,
    });
    if (!res.ok) return { enabled: true, error: res.error, model: res.model };
    const text = res.content?.trim();
    if (!text) return { enabled: true, error: 'Empty response from model.', model: res.model };
    return { enabled: true, text, model: res.model };
  } catch (e: any) {
    return { enabled: true, error: e?.message ?? 'Narrative generation failed.' };
  }
}
