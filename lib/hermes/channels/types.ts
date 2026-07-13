// Channel adapter interface — the thin, channel-agnostic shape every external
// messaging surface (Telegram now; WhatsApp / Voice later) implements so the
// inbound webhook route stays identical across channels.
//
// The contract is deliberately minimal and real — only what the webhook route
// actually needs today. No speculative fields: add to this shape when a second
// channel proves a need, not before.
//
// Flow the route drives with an adapter:
//   1. verifyInbound(req)  — authenticate the webhook (per-channel secret,
//                            constant-time). Bad → the route rejects and NEVER
//                            parses or routes the body.
//   2. parseInbound(body)  — normalise the provider payload into a single
//                            InboundMessage, or null to ignore (non-message
//                            updates, edits, missing text, …).
//   3. sendReply(chatId,…) — deliver the Brain's textual reply back to the chat.
//
// Everything here is server-only: adapters read secrets and must never be
// imported into client code.

/** Result of authenticating an inbound webhook request. */
export type ChannelVerifyResult =
  | { ok: true }
  // 503 — no webhook secret is configured for this channel (operator setup gap).
  | { ok: false; status: 503 }
  // 401 — a secret is configured but the request's secret header is missing or
  //       does not match (constant-time).
  | { ok: false; status: 401 };

/** A provider payload normalised to the fields the Brain router needs. */
export type InboundMessage = {
  /** Provider chat/conversation id (used for the Brain thread + allowlist). */
  chatId: string;
  /** Provider sender/user id (used as the audit actor label). */
  userId: string;
  /** The plain-text message body. */
  text: string;
};

export interface ChannelAdapter {
  /** Stable channel name, e.g. 'telegram' (used in thread ids + audit detail). */
  readonly name: string;

  /**
   * Authenticate an inbound webhook request. Constant-time comparison of the
   * channel's shared secret. Must NOT read or trust the request body for
   * identity — only the transport-level secret the operator set at registration.
   */
  verifyInbound(req: Request): Promise<ChannelVerifyResult>;

  /**
   * Normalise a parsed provider payload into an InboundMessage, or return null
   * to IGNORE it (non-message updates, empty/non-text messages, edits, …). The
   * route replies 200 to ignored updates so the provider stops retrying.
   */
  parseInbound(body: unknown): InboundMessage | null;

  /**
   * Deliver a plain-text reply back to `chatId`. Throws on a configuration or
   * transport failure so the route can log and still return 200 (providers
   * hammer retries on non-2xx). Never places any secret in a returned value.
   */
  sendReply(chatId: string, text: string): Promise<void>;
}
