// Typed HTTP client over Sentinel's token-gated /api/bot/* surface.
//
// Every method is a thin fetch with the bot token in `x-ingest-token` (the same
// header the ingest routes accept). The bot holds NO ops logic — all decisions
// happen server-side in Sentinel. On non-2xx we throw with the server's error so
// callers can surface it in Discord.

export type HermesProposal = {
  ok: boolean;
  configured: boolean;
  error?: string;
  classification?: string;
  priority?: string;
  draft?: string;
  sources?: string[];
  confidence?: number;
  reasoning?: string;
  model?: string;
  id?: string | null;
};

export type ProposalRecord = {
  id: string;
  ref: string;
  agent: string;
  kind: string;
  title: string;
  summary: string;
  proposal: HermesProposal;
  status: 'pending' | 'sent' | 'dismissed';
  createdAt: string;
};

export type TicketEvent = {
  ref: string;
  kind: string;
  title: string;
  status: string;
  priority: string;
  app: string;
  slaDue: string | null;
  channel: 'incidents' | 'tickets';
};

export type AgentKey = 'support' | 'incident' | 'escalation' | 'billing' | 'security';

export class SentinelClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-ingest-token': this.token,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text };
    }
    if (!res.ok) {
      throw new Error(`Sentinel ${method} ${path} → ${res.status}: ${json?.error ?? text}`);
    }
    return json as T;
  }

  createTicket(input: {
    kind: string;
    title: string;
    description?: string;
    app?: string;
    priority?: string;
    impact?: string;
    urgency?: string;
  }): Promise<{ ok: boolean; ref: string }> {
    return this.req('POST', '/api/bot/tickets', input);
  }

  addComment(
    ref: string,
    body: string,
    author: string,
    kind: 'update' | 'note' = 'update',
  ): Promise<{ ok: boolean; comment?: unknown; error?: string }> {
    return this.req('POST', `/api/bot/tickets/${encodeURIComponent(ref)}/comments`, {
      body,
      author,
      kind,
    });
  }

  triage(ref: string, agent: AgentKey = 'support'): Promise<HermesProposal> {
    return this.req('POST', '/api/bot/triage', { ref, agent });
  }

  listProposals(status = 'pending', limit = 50): Promise<{ proposals: ProposalRecord[]; live: boolean }> {
    return this.req('GET', `/api/bot/proposals?status=${encodeURIComponent(status)}&limit=${limit}`);
  }

  actOnProposal(
    id: string,
    action: 'approve' | 'dismiss' | 'mark-sent',
    by: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.req('POST', `/api/bot/proposals/${encodeURIComponent(id)}`, { action, by });
  }

  getEvents(since?: string): Promise<{ events: TicketEvent[]; cursor: string; live: boolean }> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    return this.req('GET', `/api/bot/events${qs}`);
  }
}
