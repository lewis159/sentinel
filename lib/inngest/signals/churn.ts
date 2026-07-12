// Churn-spike signal for the estate watcher.
//
// WHAT REAL DATA IS AVAILABLE (and what isn't):
//   There is NO subscription/MRR/cancellation feed wired into Sentinel yet. The
//   Stripe tools (lib/hermes/brain/tools/stripe.ts) only READ a single charge and
//   MOVE money (refund/credit) — there is no list-subscriptions / list-cancellations
//   read, and no metrics warehouse. So a "real" churn rate (cancelled MRR ÷ MRR) is
//   NOT computable from what exists today.
//
//   THE DEFENSIBLE PROXY WE DO HAVE: failed payments. The dunning workflow
//   (lib/inngest/functions/dunning.ts) fires on `payment.failed` and persists a
//   DRAFT proposal (kind = 'dunning', ref = 'invoice:<id>') per failed invoice.
//   Failed payments are the single best LEADING indicator of involuntary churn, and
//   they are already durably recorded in ops.hermes_proposals. So we compute the
//   churn signal as: DISTINCT failed invoices (by ref) with a dunning proposal in a
//   recent rolling window. A spike above threshold trips the watcher.
//
//   TODO(real-source): replace / augment this with an actual churn metric once a
//   subscription-events source lands — e.g. Stripe `customer.subscription.deleted`
//   webhooks, or a nightly MRR-churn rollup. Wire it here behind the same
//   ChurnSignal shape; the watcher does not need to change. The failed-payment
//   proxy should then become one INPUT to that metric, not the whole signal.
//
// Mock-safe: with no DB (hasDb === false) there is nothing to read → configured
// false, not tripped. Never throws (errors degrade to a not-configured signal).
import { hasDb, q1 } from '@/lib/db';

export type ChurnSeverity = 'none' | 'watch' | 'elevated' | 'spike';

export type ChurnSignal = {
  configured: boolean;     // false → no DB / no source to read
  failedInvoices: number;  // distinct failed invoices in the window (the proxy)
  windowHours: number;
  threshold: number;       // failedInvoices >= threshold → tripped
  severity: ChurnSeverity; // coarse bucket used for the de-dup fingerprint
  tripped: boolean;
  detail: string;          // human line for the proposal draft
};

// Window + threshold are env-tunable so ops can dial sensitivity without a deploy.
function windowHours(): number {
  const v = Number(process.env.CHURN_WINDOW_HOURS);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 24;
}
function threshold(): number {
  const v = Number(process.env.CHURN_SPIKE_THRESHOLD);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 3;
}

// Coarse severity bucket. Kept deliberately low-resolution so small count jitter
// doesn't change the de-dup fingerprint and re-spam the alert.
function severityFor(count: number, trip: number): ChurnSeverity {
  if (count <= 0) return 'none';
  if (count < trip) return 'watch';           // below trip line — informational only
  if (count < trip * 2) return 'elevated';    // over the line
  return 'spike';                             // well over the line
}

/**
 * Compute the churn-spike signal from the failed-payment proxy. Reads distinct
 * dunning invoices (failed payments) in the rolling window from ops.hermes_proposals.
 */
export async function churnSignal(): Promise<ChurnSignal> {
  const hrs = windowHours();
  const trip = threshold();
  const base: ChurnSignal = {
    configured: false,
    failedInvoices: 0,
    windowHours: hrs,
    threshold: trip,
    severity: 'none',
    tripped: false,
    detail: 'Churn signal not configured (no DB / no failed-payment source).',
  };
  if (!hasDb) return base;

  try {
    // Distinct failed invoices = distinct proposal `ref` for kind 'dunning' in the
    // window. The dunning workflow files up to 3 proposals per invoice (day-0/3/7),
    // all sharing one ref, so distinct-ref counts DISTINCT failed invoices, not
    // reminder stages.
    const row = await q1<{ n: string | number }>(
      `select count(distinct ref) as n
         from ops.hermes_proposals
        where kind = 'dunning'
          and created_at >= now() - make_interval(hours => $1)`,
      [hrs],
    );
    const count = Number(row?.n ?? 0) || 0;
    const severity = severityFor(count, trip);
    const tripped = count >= trip;
    return {
      configured: true,
      failedInvoices: count,
      windowHours: hrs,
      threshold: trip,
      severity,
      tripped,
      detail: tripped
        ? `Churn spike (proxy): ${count} failed payment(s) in the last ${hrs}h ` +
          `(threshold ${trip}). Leading indicator of involuntary churn — review at-risk accounts.`
        : `Failed payments in the last ${hrs}h: ${count} (threshold ${trip}).`,
    };
  } catch {
    return base;
  }
}
