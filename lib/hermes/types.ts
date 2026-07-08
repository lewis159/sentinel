// Shared contract for Hermes agent proposals. A HermesProposal is the
// structured result of asking an LLM (via OpenRouter) to reason over a ticket.
// It is copilot-first: the agent DRAFTS, a human sends. `configured` is false
// when OPENROUTER_API_KEY is unset so the UI can degrade gracefully in dev.
export type HermesProposal = {
  ok: boolean;
  configured: boolean;        // false when OPENROUTER_API_KEY is unset
  error?: string;
  classification?: string;    // e.g. "Billing · refund request"
  priority?: string;          // low | medium | high | urgent
  draft?: string;             // the drafted customer reply
  sources?: string[];         // refs/KB it leaned on
  confidence?: number;        // 0-100
  reasoning?: string;         // one-paragraph why
  model?: string;             // model that answered
};
