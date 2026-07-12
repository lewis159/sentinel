// Dunning — failed-payment recovery workflow (durable, multi-day).
//
// Trigger: the `payment.failed` event (fired when a Stripe/estate invoice fails).
// Over several days we DRAFT a series of retry-reminder emails, each as a GATED
// proposal in the Sentinel Approvals queue. Between reminders the run sleeps with
// Inngest `step.sleep` — the run is durable, so the sleep survives redeploys and
// the day-3/day-7 reminders fire even if the app restarts in between.
//
// SAFETY — NO UNILATERAL ACTION. This workflow never sends an email and never
// moves money. Each step only DRAFTS a reminder and persists it via the existing
// proposal spine (saveProposal). A human reviews + approves each draft in the
// Approvals queue; sending is their explicit action, not ours.
//
// IDEMPOTENCY / exactly-once:
//   • Event dedup: callers should send `payment.failed` with a stable event `id`
//     of `dunning:<invoiceId>` so a retried webhook does NOT start a second run
//     for the same invoice (Inngest dedups events by id within a 24h window).
//   • Step memoization: each proposal is created inside its own named `step.run`.
//     Inngest memoizes a completed step's result, so a retry/replay of the run
//     re-uses the prior result WITHOUT creating a duplicate proposal. That makes
//     "one reminder per stage per invoice" the exactly-once guarantee.
import { inngest, type PaymentFailedEvent, type StepLike } from '@/lib/inngest/client';
import { saveProposal } from '@/lib/hermes/proposals';
import type { HermesProposal } from '@/lib/hermes/types';

// The reminder cadence: label + how long to wait BEFORE drafting this stage.
// Stage 0 drafts immediately; later stages sleep first.
const STAGES: { key: string; waitFromPrev: string; tone: string }[] = [
  { key: 'day-0', waitFromPrev: '0s', tone: 'a friendly first heads-up that the payment failed' },
  { key: 'day-3', waitFromPrev: '3d', tone: 'a firmer reminder that the invoice is still unpaid' },
  { key: 'day-7', waitFromPrev: '4d', tone: 'a final notice before the account is suspended' },
];

function money(amountMinor: number, currency: string): string {
  const major = (amountMinor / 100).toFixed(2);
  return `${currency.toUpperCase()} ${major}`;
}

// Compose the drafted reminder email as a HermesProposal. `draft` holds the body
// a human will review; there is no `action` block, so approval routes through the
// copilot draft path — it never auto-executes a tool.
function draftFor(
  stage: { key: string; tone: string },
  data: PaymentFailedEvent['data'],
): HermesProposal {
  const currency = data.currency ?? 'gbp';
  const who = data.customerName ?? data.customerEmail;
  const amount = money(data.amountMinor, currency);
  const body = [
    `Hi ${who},`,
    '',
    `We tried to collect ${amount} for invoice ${data.invoiceId} but the payment didn't go through.`,
    `Please update your payment method or retry the charge to keep your service active.`,
    '',
    `— The Sentinel billing team`,
  ].join('\n');
  return {
    ok: true,
    configured: true,
    classification: `Dunning · ${stage.key} · ${stage.tone}`,
    priority: stage.key === 'day-7' ? 'high' : 'medium',
    draft: body,
    reasoning:
      `Failed payment on invoice ${data.invoiceId} (${amount}). Drafted ${stage.key} reminder ` +
      `to ${data.customerEmail} for human review — nothing is sent until approved.`,
    sources: [data.ref ?? `invoice:${data.invoiceId}`],
  };
}

// Exported handler (separate from createFunction) so unit tests can drive it with
// a mocked `step` and assert it only DRAFTS a proposal.
export async function dunningHandler({
  event,
  step,
}: {
  event: PaymentFailedEvent;
  step: StepLike;
}): Promise<{ invoiceId: string; proposals: (string | null)[] }> {
  const data = event.data;
  const proposals: (string | null)[] = [];

  for (const stage of STAGES) {
    // Durable wait between stages. Stage 0 waits 0s (fires immediately).
    if (stage.waitFromPrev !== '0s') {
      await step.sleep(`wait-${stage.key}-${data.invoiceId}`, stage.waitFromPrev);
    }
    // One proposal per (invoice, stage). The step id is deterministic per invoice,
    // so a replay re-uses the memoized result instead of drafting a duplicate.
    const proposalId = await step.run(`draft-${stage.key}-${data.invoiceId}`, async () => {
      const proposal = draftFor(stage, data);
      return saveProposal({
        ref: data.ref ?? `invoice:${data.invoiceId}`,
        agent: 'billing',
        kind: 'dunning',
        title: `Dunning reminder (${stage.key}) — invoice ${data.invoiceId}`,
        summary: `Draft ${stage.key} failed-payment reminder to ${data.customerEmail} (${money(
          data.amountMinor,
          data.currency ?? 'gbp',
        )}). Review + approve to send.`,
        proposal,
      });
    });
    proposals.push(proposalId);
  }

  return { invoiceId: data.invoiceId, proposals };
}

export const dunning = inngest.createFunction(
  {
    id: 'dunning-failed-payment',
    name: 'Dunning — failed-payment recovery',
    triggers: [{ event: 'payment.failed' }],
  },
  // The inline handler receives SDK-typed { event, step }; we adapt to the
  // exported, test-friendly handler (its narrower step interface is structurally
  // satisfied by the real SDK step).
  async ({ event, step }) =>
    dunningHandler({ event: event as unknown as PaymentFailedEvent, step }),
);
