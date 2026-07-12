// Churn-Save — at-risk account scorer.
//
// WHAT THIS DOES: ranks accounts/customers by how likely they are to churn, from
// the signals Sentinel actually has today. It is DETERMINISTIC and MOCK-SAFE — the
// pure scorer (scoreAtRisk) takes normalized signals and always returns a stable
// ranking, so the console renders with or without a DB and with or without the LLM.
//
// SIGNALS WE USE (defensible proxies — see lib/inngest/signals/churn.ts for why a
// "real" MRR-churn number isn't computable yet):
//   1. FAILED PAYMENTS — the dunning proxy. Each distinct failed invoice (a
//      kind='dunning' proposal) is the single best LEADING indicator of involuntary
//      churn. Later stages (day-7 "final notice") weigh more.
//   2. NEGATIVE / URGENT TICKETS — an urgent|critical open ticket, or a ticket whose
//      title/description carries cancellation/refund/complaint language, is a strong
//      voluntary-churn signal.
//   3. STALLED TICKETS — an open ticket left ageing (>3d) reads as an ignored
//      customer — friction that compounds churn risk.
//
// The scorer is PURE (no I/O, no server-only) so it unit-tests directly. The async
// collector (collectAtRiskAccounts) reads the real signals and feeds the scorer;
// it degrades to mock tickets with no DB so the page always has something to show.
import { getTicketsByKind } from '@/lib/data';
import { listProposals } from '@/lib/hermes/proposals';
import type { TicketKind } from '@/lib/mock';

// ---- Public shapes ---------------------------------------------------------

export type AtRiskAccount = {
  key: string; // stable grouping key (email → tenantRef → 'unknown')
  tenantRef: string | null;
  email: string | null;
  label: string; // display name
  riskScore: number; // 0-100, higher = more at risk
  reasons: string[]; // human-readable contributing signals, priority order
  lastSignal: string | null; // the most salient recent signal line
  failedPayments: number;
  openTickets: number;
};

// Normalized inputs to the pure scorer — decoupled from the DB row shapes so the
// scorer is trivial to drive from a test.
export type TicketSignal = {
  ref: string;
  tenantRef: string | null;
  email: string | null;
  customerName?: string | null;
  priority: string;
  status: string;
  title?: string;
  description?: string;
  age?: string | null; // relative age string, e.g. "2h", "3d"
};

export type DunningSignal = {
  ref: string; // e.g. "invoice:inv_001"
  tenantRef: string | null;
  email: string | null;
  customerName?: string | null;
  stage?: string | null; // "day-0" | "day-3" | "day-7"
  createdAt?: string | null;
};

export type AtRiskInputs = { tickets: TicketSignal[]; dunning: DunningSignal[] };

// ---- Scoring constants -----------------------------------------------------

// Statuses that mean the ticket is DONE — anything else counts as still-open.
const CLOSED_STATUSES = new Set([
  'closed',
  'resolved',
  'fulfilled',
  'deployed',
  'verified',
  'known_error',
  'implemented',
]);

// Language that signals a customer is unhappy / thinking about leaving.
const NEGATIVE_TERMS = [
  'cancel',
  'refund',
  'angry',
  'unhappy',
  'disappoint',
  'downgrade',
  'leave',
  'leaving',
  'churn',
  'competitor',
  'switch',
  'terminate',
  'complaint',
  'frustrat',
  'not working',
  'broken',
];

const W = {
  failedPayment: 22, // per distinct failed invoice
  finalNotice: 12, // extra when a dunning stage is the day-7 final notice
  urgentOpen: 20, // per open urgent/critical ticket
  highOpen: 10, // per open high-priority ticket
  negative: 15, // per ticket with cancellation/complaint language
  stalled: 8, // per open ticket left ageing > 3 days
};

function isOpen(status: string): boolean {
  return !CLOSED_STATUSES.has((status || '').toLowerCase());
}

function ageDays(age?: string | null): number {
  if (!age) return 0;
  const d = /(\d+)\s*d/.exec(age);
  if (d) return Number(d[1]);
  const w = /(\d+)\s*w/.exec(age);
  if (w) return Number(w[1]) * 7;
  return 0; // hours/minutes → < 1 day
}

function hasNegativeLanguage(t: TicketSignal): boolean {
  const hay = `${t.title ?? ''} ${t.description ?? ''}`.toLowerCase();
  return NEGATIVE_TERMS.some((term) => hay.includes(term));
}

// Grouping key — prefer email (both tickets and parsed dunning carry it, so the
// same customer merges across signal sources), then tenantRef, then a fallback.
function accountKey(email: string | null, tenantRef: string | null): string {
  return (email && email.toLowerCase()) || tenantRef || 'unknown';
}

type Bucket = {
  key: string;
  tenantRef: string | null;
  email: string | null;
  customerName: string | null;
  reasons: { rank: number; text: string; last?: string }[];
  score: number;
  failedPayments: number;
  openTickets: number;
};

function bucketFor(map: Map<string, Bucket>, key: string, email: string | null, tenantRef: string | null): Bucket {
  let b = map.get(key);
  if (!b) {
    b = {
      key,
      tenantRef,
      email,
      customerName: null,
      reasons: [],
      score: 0,
      failedPayments: 0,
      openTickets: 0,
    };
    map.set(key, b);
  }
  // Enrich identity as later signals fill gaps.
  if (!b.email && email) b.email = email;
  if (!b.tenantRef && tenantRef) b.tenantRef = tenantRef;
  return b;
}

/**
 * PURE, deterministic at-risk scorer. Given normalized ticket + dunning signals,
 * groups them per account, scores the risk, and returns the accounts ranked
 * most-at-risk first. Never throws; accounts with zero risk are excluded.
 */
export function scoreAtRisk(inputs: AtRiskInputs): AtRiskAccount[] {
  const map = new Map<string, Bucket>();

  // 1) Failed payments (dunning proxy) — the strongest leading indicator. Count
  //    DISTINCT invoices per account so day-0/3/7 reminders for one invoice don't
  //    triple-count.
  const seenInvoice = new Set<string>();
  for (const d of inputs.dunning) {
    const key = accountKey(d.email, d.tenantRef);
    const b = bucketFor(map, key, d.email, d.tenantRef);
    if (d.customerName && !b.customerName) b.customerName = d.customerName;
    const invoiceKey = `${key}::${d.ref}`;
    if (seenInvoice.has(invoiceKey)) continue;
    seenInvoice.add(invoiceKey);
    b.failedPayments += 1;
    b.score += W.failedPayment;
    const stage = (d.stage ?? '').toLowerCase();
    const isFinal = stage.includes('7') || stage.includes('final');
    if (isFinal) b.score += W.finalNotice;
    b.reasons.push({
      rank: 0,
      text: `Failed payment${stage ? ` (dunning ${stage}${isFinal ? ', final notice' : ''})` : ''} — ${d.ref}`,
      last: `Failed payment${stage ? ` · ${stage}` : ''}`,
    });
  }

  // 2) Ticket signals — urgent/high open tickets, negative language, stalling.
  for (const t of inputs.tickets) {
    // A ticket with no customer identity is an internal/estate ticket — not an
    // account we can win back. Skip it.
    if (!t.email && !t.tenantRef) continue;
    const key = accountKey(t.email, t.tenantRef);
    const b = bucketFor(map, key, t.email, t.tenantRef);
    if (t.customerName && !b.customerName) b.customerName = t.customerName;

    const open = isOpen(t.status);
    const prio = (t.priority || '').toLowerCase();
    if (open) b.openTickets += 1;

    if (open && (prio === 'urgent' || prio === 'critical')) {
      b.score += W.urgentOpen;
      b.reasons.push({ rank: 1, text: `Urgent open ticket — ${t.ref}`, last: `Urgent ticket ${t.ref}` });
    } else if (open && prio === 'high') {
      b.score += W.highOpen;
      b.reasons.push({ rank: 3, text: `High-priority open ticket — ${t.ref}` });
    }

    if (hasNegativeLanguage(t)) {
      b.score += W.negative;
      const snippet = (t.title ?? '').slice(0, 60);
      b.reasons.push({ rank: 2, text: `Negative sentiment — "${snippet}" (${t.ref})`, last: `Complaint ${t.ref}` });
    }

    if (open && ageDays(t.age) >= 3) {
      b.score += W.stalled;
      b.reasons.push({ rank: 4, text: `Stalled open ticket — ${t.ref} (${t.age})` });
    }
  }

  // Build the ranked output.
  const out: AtRiskAccount[] = [];
  for (const b of map.values()) {
    if (b.score <= 0 || b.reasons.length === 0) continue;
    const reasons = [...b.reasons].sort((a, c) => a.rank - c.rank);
    const label = b.customerName || b.email || b.tenantRef || b.key;
    const lastSignal = reasons.find((r) => r.last)?.last ?? reasons[0]?.text ?? null;
    out.push({
      key: b.key,
      tenantRef: b.tenantRef,
      email: b.email,
      label,
      riskScore: Math.min(100, Math.round(b.score)),
      reasons: reasons.map((r) => r.text),
      lastSignal,
      failedPayments: b.failedPayments,
      openTickets: b.openTickets,
    });
  }

  // Rank: highest risk first, then more distinct reasons, then label for a stable
  // deterministic order.
  out.sort(
    (a, c) =>
      c.riskScore - a.riskScore ||
      c.reasons.length - a.reasons.length ||
      a.label.localeCompare(c.label),
  );
  return out;
}

// ---- Async collector (reads real signals, mock-safe) -----------------------

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const TICKET_KINDS: TicketKind[] = ['incident', 'request', 'change', 'problem', 'release'];

// A dunning proposal's contact + amount live in its human summary line (see
// lib/inngest/functions/dunning.ts). We extract the customer email from there and
// the stage from the title ("Dunning reminder (day-7) — invoice …").
function dunningFromProposal(p: {
  ref: string;
  title: string;
  summary: string;
  createdAt: string;
}): DunningSignal {
  const email = EMAIL_RE.exec(p.summary)?.[0] ?? EMAIL_RE.exec(p.title)?.[0] ?? null;
  const stage = /\b(day-\d+|final)\b/i.exec(p.title)?.[1] ?? null;
  return {
    ref: p.ref || 'invoice:unknown',
    tenantRef: null,
    email,
    stage: stage ? stage.toLowerCase() : null,
    createdAt: p.createdAt,
  };
}

/**
 * Read the real at-risk signals and score them. Mock-safe:
 *   - no DB → getTicketsByKind returns mock service tickets (operator view) and
 *     listProposals returns [] → the ranking still renders from the mock tickets.
 * Never throws; on any read error that source simply contributes nothing.
 */
export async function collectAtRiskAccounts(): Promise<{ accounts: AtRiskAccount[]; live: boolean }> {
  const tickets: TicketSignal[] = [];
  const dunning: DunningSignal[] = [];
  let live = false;

  for (const kind of TICKET_KINDS) {
    try {
      const res = await getTicketsByKind(kind);
      if (res.live) live = true;
      for (const t of res.rows) {
        tickets.push({
          ref: t.ref,
          tenantRef: t.tenantRef,
          email: t.customerEmail,
          customerName: t.customerName,
          priority: t.priority,
          status: t.status,
          title: t.title,
          description: t.description,
          age: t.age,
        });
      }
    } catch {
      /* this kind contributes nothing */
    }
  }

  try {
    const props = await listProposals({ limit: 200 });
    if (props.length) live = true;
    for (const p of props) {
      if (p.kind !== 'dunning') continue;
      dunning.push(dunningFromProposal(p));
    }
  } catch {
    /* no dunning signal */
  }

  return { accounts: scoreAtRisk({ tickets, dunning }), live };
}
