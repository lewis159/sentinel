// Revenue metrics for the board update — the READ-ONLY money path.
//
// IMPORTANT (assumption documented for the report): the Hermes Stripe tool path
// (lib/hermes/brain/tools/stripe.ts) is a SINGLE-CHARGE read (getCharge) plus
// gated refund/credit writes. There is NO MRR / churn / runway source wired into
// this app. So:
//   - newRevenue  → best-effort: summed from Stripe `/charges` for the period
//                   WHEN STRIPE_SECRET_KEY is present (read-only). Otherwise "no data".
//   - MRR, churn  → NOT derivable from charges → placeholder "no data" + TODO
//                   naming the real source (Stripe Billing subscriptions rollup).
//   - runway      → needs cash balance + burn (not in-app) → "no data" + TODO.
//
// The key is read env-first then Infisical, mirroring the Stripe tool. It is
// NEVER logged. Missing key / any error → graceful "no data" (never a throw).

import 'server-only';
import { getSecret } from '@/lib/secrets';
import type { Period, MetricValue, RevenueMetrics } from './assemble';

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeKey(): Promise<string | undefined> {
  return process.env.STRIPE_SECRET_KEY || (await getSecret('STRIPE_SECRET_KEY')) || undefined;
}

const TODO_MRR =
  'TODO: wire a real MRR source — Stripe Billing subscriptions rollup (or a metrics table). The in-app Stripe path (getCharge) is single-charge read only and cannot derive MRR.';
const TODO_CHURN =
  'TODO: wire a real churn source — derive from Stripe subscription cancellations/downgrades over the period (not available from the charges read path).';
const TODO_RUNWAY =
  'TODO: wire runway — needs cash-on-hand + monthly burn (finance source), neither of which is in the app today.';

function noData(source: string, todo: string): MetricValue {
  return { available: false, display: 'No data', source, todo };
}

function fmtMoney(minor: number, currency: string): string {
  const symbol = currency.toUpperCase() === 'GBP' ? '£' : currency.toUpperCase() === 'USD' ? '$' : '';
  const major = (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `${symbol}${major}` : `${major} ${currency.toUpperCase()}`;
}

// Best-effort new-revenue: sum SUCCEEDED, non-refunded charges created within the
// period. One page (100) — enough for a monthly headline; heavy months would need
// pagination (noted in the TODO). Any failure → "no data" rather than a fabricated
// number.
async function readNewRevenue(period: Period, key: string): Promise<MetricValue> {
  const source = 'Stripe /charges (read-only)';
  try {
    const gte = Math.floor(period.start.getTime() / 1000);
    const lt = Math.floor(period.end.getTime() / 1000);
    const url = `${STRIPE_API}/charges?limit=100&created[gte]=${gte}&created[lt]=${lt}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return noData(source, `Stripe charges read failed (HTTP ${res.status}) — showing no data rather than a guess.`);
    const body: any = await res.json().catch(() => ({}));
    const charges: any[] = Array.isArray(body?.data) ? body.data : [];
    let minor = 0;
    let currency = 'gbp';
    for (const c of charges) {
      if (c?.status === 'succeeded' && c?.paid && !c?.refunded && typeof c?.amount === 'number') {
        minor += c.amount - (typeof c.amount_refunded === 'number' ? c.amount_refunded : 0);
        if (typeof c.currency === 'string') currency = c.currency;
      }
    }
    const partial = body?.has_more ? ' (first 100 charges — TODO paginate for full total)' : '';
    return {
      available: true,
      value: minor,
      currency,
      display: `${fmtMoney(minor, currency)}${partial}`,
      source,
    };
  } catch {
    return noData(source, 'Stripe charges read errored — showing no data rather than a guess.');
  }
}

export async function readRevenue(period: Period): Promise<RevenueMetrics> {
  const key = await stripeKey();

  const mrr = noData('Stripe Billing (not wired)', TODO_MRR);
  const churn = noData('Stripe Billing (not wired)', TODO_CHURN);
  const runway = noData('Finance (not wired)', TODO_RUNWAY);

  const newRevenue = key
    ? await readNewRevenue(period, key)
    : noData(
        'Stripe /charges (read-only)',
        'TODO: set STRIPE_SECRET_KEY in the deploy env (currently held in the scribuo-prod Infisical vault) to sum period revenue from charges.',
      );

  return { mrr, newRevenue, churn, runway };
}
