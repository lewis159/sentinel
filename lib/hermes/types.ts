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

  // ---- Brain action spine (P0) ----------------------------------------------
  // When a proposal represents a GATED tool call the Brain paused on (interrupt),
  // this carries everything the Approve path needs to RESUME the graph and run the
  // tool for real: which tool, its args, and the thread to resume. Absent on plain
  // copilot drafts (which keep the legacy "post draft as a comment" behaviour).
  action?: {
    tool: string;                    // tool name, e.g. 'updateTicket'
    args: Record<string, unknown>;   // validated tool args
    threadId: string;                // graph thread to resume, e.g. 'discord:123'
    callId?: string;                 // the interrupted tool_call id
    persona?: string;                // persona that proposed it (e.g. 'pa')
    // Populated after execution, for audit/history.
    result?: string;                 // tool observation summary
    executedAt?: string;             // ISO timestamp of execution
  };
};
