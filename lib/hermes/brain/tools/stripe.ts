// Stripe action tools for the Brain — the CFO/billing copilot's real money path.
//
//   getCharge     (auto)  — read-only lookup of a charge (safe; no side-effect).
//   refundCharge  (GATED) — issue a refund against a charge / payment_intent.
//   issueCredit   (GATED) — apply an account-balance credit to a customer.
//
// GATED tools MUTATE money, so they only ever run AFTER a human approves the
// proposal in the Sentinel Approvals queue — the graph interrupts on gated tools
// and the generic resume path calls run() exactly once. There is NO auto-execute
// path for a refund/credit here; run() performs the side-effect only post-approval.
//
// Config (KEY LOCATION NOTE): STRIPE_SECRET_KEY currently lives in the
// `scribuo-prod` Infisical vault, NOT the `hermes/prod` vault. Until it is copied
// into the Hermes vault, these tools read it from the process env `STRIPE_SECRET_KEY`
// — so that env var MUST be populated in the Sentinel deploy for refunds/credits to
// work. We also try Infisical getSecret('STRIPE_SECRET_KEY') as a fallback for when
// the secret is later mirrored into the Hermes vault. The key is NEVER hardcoded and
// NEVER logged. Missing key → a clear "not configured" result (never an unhandled throw).
//
// We deliberately use the Stripe REST API over fetch rather than pulling in the
// heavy `stripe` npm SDK (it is not a dependency of this app). Stripe's API is
// form-encoded (application/x-www-form-urlencoded), not JSON.
import 'server-only';
import { z } from 'zod';
import { getSecret } from '@/lib/secrets';
import type { BrainTool } from './types';

const STRIPE_API = 'https://api.stripe.com/v1';

// STRIPE_SECRET_KEY: env first (documented requirement — populate it in the deploy),
// then Infisical as a fallback for when the secret is mirrored into the Hermes vault.
async function stripeKey(): Promise<string | undefined> {
  return process.env.STRIPE_SECRET_KEY || (await getSecret('STRIPE_SECRET_KEY')) || undefined;
}

const NOT_CONFIGURED =
  'Stripe not configured — set STRIPE_SECRET_KEY (currently held in the scribuo-prod Infisical vault; populate it in the Hermes deploy env).';

type StripeResult = { ok: boolean; status: number; body: any };

// POST an application/x-www-form-urlencoded body to the Stripe API.
async function stripePost(path: string, form: Record<string, string>, key: string): Promise<StripeResult> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function stripeGet(path: string, key: string): Promise<StripeResult> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function stripeError(r: StripeResult): string {
  return r.body?.error?.message || `Stripe API error (HTTP ${r.status})`;
}

// ---------- getCharge (auto / read) ----------
const getChargeSchema = z.object({
  chargeId: z.string().describe('The Stripe charge id to look up, e.g. ch_3Ab... .'),
});

export const getChargeTool: BrainTool<z.infer<typeof getChargeSchema>> = {
  name: 'getCharge',
  description:
    'Read a Stripe charge by id (amount, currency, status, whether already refunded, customer, description). Safe read — use before recommending or issuing a refund.',
  schema: getChargeSchema,
  autonomy: 'auto',
  run: async ({ chargeId }) => {
    const key = await stripeKey();
    if (!key) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    const r = await stripeGet(`/charges/${encodeURIComponent(chargeId)}`, key);
    if (!r.ok) return { ok: false, summary: `Could not read ${chargeId}: ${stripeError(r)}`, error: 'stripe_error' };
    const c = r.body;
    const major = typeof c.amount === 'number' ? (c.amount / 100).toFixed(2) : '?';
    return {
      ok: true,
      summary: `${c.id}: ${major} ${String(c.currency ?? '').toUpperCase()} — status ${c.status}, refunded ${c.refunded ? 'yes' : 'no'}${c.amount_refunded ? ` (${(c.amount_refunded / 100).toFixed(2)} refunded)` : ''}.`,
      data: {
        id: c.id,
        amount: c.amount,
        amount_refunded: c.amount_refunded,
        currency: c.currency,
        status: c.status,
        refunded: c.refunded,
        paid: c.paid,
        customer: c.customer,
        payment_intent: c.payment_intent,
        description: c.description,
      },
    };
  },
};

// ---------- refundCharge (GATED / money out) ----------
const refundChargeSchema = z
  .object({
    chargeId: z.string().optional().describe('The charge id to refund, e.g. ch_3Ab... . Provide this OR paymentIntentId.'),
    paymentIntentId: z
      .string()
      .optional()
      .describe('The payment_intent id to refund, e.g. pi_3Ab... . Provide this OR chargeId.'),
    amount: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Amount to refund in the SMALLEST currency unit (e.g. pence). Omit for a full refund.'),
    reason: z
      .enum(['duplicate', 'fraudulent', 'requested_by_customer'])
      .optional()
      .describe('Stripe refund reason. Defaults to requested_by_customer.'),
  })
  .refine((a) => Boolean(a.chargeId || a.paymentIntentId), {
    message: 'Provide either chargeId or paymentIntentId.',
  });
export type RefundChargeArgs = z.infer<typeof refundChargeSchema>;

export const refundChargeTool: BrainTool<RefundChargeArgs> = {
  name: 'refundCharge',
  description:
    'Issue a Stripe REFUND against a charge or payment_intent (optionally a partial amount in minor units). This MOVES MONEY, so it requires human approval before it runs.',
  schema: refundChargeSchema,
  autonomy: 'gated',
  describeCall: (a) => {
    const target = a.chargeId ? `charge ${a.chargeId}` : `payment_intent ${a.paymentIntentId}`;
    const amt = a.amount ? `${(a.amount / 100).toFixed(2)} (minor ${a.amount})` : 'full amount';
    return `Refund ${amt} on ${target}${a.reason ? ` — reason ${a.reason}` : ''}`;
  },
  // Partial refunds are budget-checked against the amount. A full refund (amount
  // omitted) can't be sized without a lookup → 0 here; the human gate is the
  // primary control for those.
  estimateMinor: (a) => a.amount ?? 0,
  run: async ({ chargeId, paymentIntentId, amount, reason }) => {
    const key = await stripeKey();
    if (!key) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    const form: Record<string, string> = {};
    if (chargeId) form.charge = chargeId;
    else if (paymentIntentId) form.payment_intent = paymentIntentId;
    else return { ok: false, summary: 'No charge or payment_intent supplied.', error: 'bad_request' };
    if (typeof amount === 'number') form.amount = String(amount);
    form.reason = reason ?? 'requested_by_customer';

    const r = await stripePost('/refunds', form, key);
    if (!r.ok) return { ok: false, summary: `Refund failed: ${stripeError(r)}`, error: 'stripe_error' };
    const ref = r.body;
    const major = typeof ref.amount === 'number' ? (ref.amount / 100).toFixed(2) : '?';
    return {
      ok: true,
      summary: `Refunded ${major} ${String(ref.currency ?? '').toUpperCase()} — refund ${ref.id}, status ${ref.status}.`,
      data: { id: ref.id, amount: ref.amount, currency: ref.currency, status: ref.status, charge: ref.charge, payment_intent: ref.payment_intent },
    };
  },
};

// ---------- issueCredit (GATED / account credit) ----------
const issueCreditSchema = z.object({
  customerId: z.string().describe('The Stripe customer id to credit, e.g. cus_Ab... .'),
  amount: z
    .number()
    .int()
    .positive()
    .describe('Credit amount in the SMALLEST currency unit (e.g. pence). Applied as an account-balance credit.'),
  currency: z.string().describe('3-letter ISO currency code, e.g. gbp.'),
  description: z.string().optional().describe('Note stored on the balance transaction.'),
});
export type IssueCreditArgs = z.infer<typeof issueCreditSchema>;

export const issueCreditTool: BrainTool<IssueCreditArgs> = {
  name: 'issueCredit',
  description:
    "Apply an account-balance CREDIT to a Stripe customer (reduces what they owe on future invoices). This is a financial concession, so it requires human approval before it runs.",
  schema: issueCreditSchema,
  autonomy: 'gated',
  describeCall: (a) =>
    `Credit ${(a.amount / 100).toFixed(2)} ${a.currency.toUpperCase()} to customer ${a.customerId}${a.description ? ` — "${a.description.slice(0, 60)}"` : ''}`,
  estimateMinor: (a) => Math.abs(a.amount),
  run: async ({ customerId, amount, currency, description }) => {
    const key = await stripeKey();
    if (!key) return { ok: false, summary: NOT_CONFIGURED, error: 'not_configured' };
    // A NEGATIVE balance transaction is a credit to the customer in Stripe.
    const form: Record<string, string> = {
      amount: String(-Math.abs(amount)),
      currency: currency.toLowerCase(),
    };
    if (description) form.description = description;
    const r = await stripePost(`/customers/${encodeURIComponent(customerId)}/balance_transactions`, form, key);
    if (!r.ok) return { ok: false, summary: `Credit failed: ${stripeError(r)}`, error: 'stripe_error' };
    const tx = r.body;
    return {
      ok: true,
      summary: `Credited ${(amount / 100).toFixed(2)} ${currency.toUpperCase()} to ${customerId} (balance tx ${tx.id}).`,
      data: { id: tx.id, amount: tx.amount, currency: tx.currency, ending_balance: tx.ending_balance, customer: customerId },
    };
  },
};
