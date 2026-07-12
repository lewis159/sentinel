// Inngest client for Sentinel — the APP side of the self-hosted Inngest stack.
//
// The Inngest SERVER runs as a separate Swarm service (image inngest/inngest,
// event API on :8288). This client is what our Next app uses to (a) SEND events
// into that server and (b) be discovered/synced by it via the serve endpoint
// (app/api/inngest/route.ts).
//
// Everything Inngest adds is behind the HERMES_INNGEST_ENABLED flag so the
// existing app is completely unaffected when it's off: the serve route no-ops
// (503) and no functions are registered/synced. This lets us ship the app-side
// code BEFORE the server exists without any risk to the running app.
//
// Env (all read automatically by the SDK, listed here for the deployer):
//   HERMES_INNGEST_ENABLED  — master flag; unset/false → Inngest is inert.
//   INNGEST_BASE_URL        — the self-hosted server event API. Default
//                             http://inngest:8288 (the Swarm service DNS name).
//   INNGEST_EVENT_KEY       — auth for SENDING events (server "event key").
//   INNGEST_SIGNING_KEY     — auth between server↔app on the serve endpoint
//                             (read by the serve handler, not the client).
//   INNGEST_DEV             — set to 0 in prod to force Cloud/self-hosted mode
//                             (dev mode is the SDK default when unset locally).
import { Inngest } from 'inngest';

/**
 * Master feature flag. When false, the serve endpoint no-ops and functions are
 * never registered with (synced to) the server — so nothing Inngest can fire.
 *   HERMES_INNGEST_ENABLED=1|true|yes|on → app-side Inngest is live.
 */
export function inngestEnabled(): boolean {
  const v = (process.env.HERMES_INNGEST_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// The self-hosted server's event API. Defaults to the in-cluster service name so
// a stock deploy talks to the sidecar Inngest service without extra config.
const baseUrl = process.env.INNGEST_BASE_URL || 'http://inngest:8288';

// `isDev` is left to the SDK's own resolution (it reads INNGEST_DEV). We pass
// baseUrl explicitly so both event-send and register calls target the self-hosted
// server; eventKey/signingKey are read from env automatically by the SDK.
export const inngest = new Inngest({
  id: 'sentinel',
  baseUrl,
  // Explicit is harmless and documents intent; undefined falls back to env.
  eventKey: process.env.INNGEST_EVENT_KEY,
});

// ---------------------------------------------------------------------------
// Event contracts (documentation + a light type aid for `inngest.send`).
// These are the events our functions listen for. Cron-triggered functions don't
// need an event payload.
// ---------------------------------------------------------------------------
// A minimal, SDK-compatible view of the Inngest `step` API — just the bits our
// handlers use. Kept loose (run returns Promise<any>) so the real SDK step (whose
// run returns a Jsonify<T>) is structurally assignable, and so unit tests can pass
// a trivial fake step. This lets the workflow handlers be exported + tested in
// isolation from the SDK's heavy generic types.
export type StepLike = {
  run: (id: string, fn: () => any) => Promise<any>;
  sleep: (id: string, duration: string) => Promise<unknown>;
};

export type PaymentFailedEvent = {
  name: 'payment.failed';
  data: {
    invoiceId: string;        // Stripe/estate invoice id — the idempotency anchor.
    customerEmail: string;    // where a dunning reminder would be drafted TO.
    amountMinor: number;      // amount owed, in minor units (pence).
    currency?: string;        // ISO currency, default 'gbp'.
    customerName?: string;
    attempt?: number;         // payment attempt number, if known.
    ref?: string;             // optional ticket/customer ref to attach the proposal to.
  };
};
