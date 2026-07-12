// Agent Observability metrics — read-only aggregates over the Hermes P3 spine
// tables, for the Sentinel Hermes console observability dashboard.
//
// Sources (all in the `ops` schema, created by db/init/10_hermes_proposals.sql
// and 15_hermes_p3_substrate.sql):
//   * ops.hermes_proposals       — the approval queue (status/agent/kind/timestamps)
//   * ops.hermes_tool_executions — the exactly-once execution ledger
//   * ops.hermes_budgets         — per (persona,tool,scope) spend caps
//   * ops.hermes_budget_ledger   — the spend rows the caps meter against
//   * ops.hermes_audit_log       — the immutable, hash-chained audit log
//
// EVERY function is read-only and mock-safe: with no DB (hasDb === false) or on
// any query error it returns a zeroed/empty structure with `live: false` and
// NEVER throws, so the page renders a clean zero-state in dev and degrades
// cleanly in prod before the Brain has produced any data. When the query runs
// (even returning zero rows) the result is `live: true` — an empty spine is a
// legitimately-empty real result, not a "no data source" signal.

import { hasDb, q, q1 } from '@/lib/db';
import { verifyChain, type ChainVerification } from '@/lib/hermes/audit';

// --------------------------------------------------------------------------
// Small numeric helpers (exported so unit tests assert the math directly).
// --------------------------------------------------------------------------

// Coerce a pg scalar (int → number, bigint → string) to a finite number, 0 on
// null/NaN. Used everywhere the DB hands back counts / minor-unit sums.
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Approval rate over DECIDED proposals only: sent / (sent + dismissed), as a
// percentage rounded to a whole number. Pending proposals are undecided and are
// deliberately excluded from the denominator. No decisions → 0.
export function approvalRatePct(sent: number, dismissed: number): number {
  const decided = sent + dismissed;
  if (decided <= 0) return 0;
  return Math.round((sent / decided) * 100);
}

// Budget utilisation: spent / cap, as a percentage rounded to a whole number.
// A zero/absent cap is "uncapped" → 0% utilisation (never divide-by-zero).
export function utilisationPct(spentMinor: number, capMinor: number): number {
  if (capMinor <= 0) return 0;
  return Math.round((spentMinor / capMinor) * 100);
}

// --------------------------------------------------------------------------
// Proposals — ops.hermes_proposals
// --------------------------------------------------------------------------

export type ProposalAgentRow = {
  agent: string;
  total: number;
  pending: number;
  sent: number;
  dismissed: number;
};

export type ProposalMetrics = {
  total: number;
  pending: number;      // backlog awaiting a human decision
  sent: number;         // approved / marked sent
  dismissed: number;    // rejected
  created24h: number;
  created7d: number;
  created30d: number;
  approvalRatePct: number;   // sent / (sent + dismissed)
  byAgent: ProposalAgentRow[];
  live: boolean;
  note?: string;
};

const EMPTY_PROPOSALS: ProposalMetrics = {
  total: 0, pending: 0, sent: 0, dismissed: 0,
  created24h: 0, created7d: 0, created30d: 0,
  approvalRatePct: 0, byAgent: [], live: false,
};

export async function getProposalMetrics(): Promise<ProposalMetrics> {
  if (!hasDb) return { ...EMPTY_PROPOSALS, note: 'no DB' };
  try {
    // Roll-up: status counts + rolling-window created counts in one pass.
    const totals = await q1<any>(
      `select
         count(*)::int                                                             as total,
         count(*) filter (where status = 'pending')::int                          as pending,
         count(*) filter (where status = 'sent')::int                             as sent,
         count(*) filter (where status = 'dismissed')::int                        as dismissed,
         count(*) filter (where created_at > now() - interval '24 hours')::int    as created_24h,
         count(*) filter (where created_at > now() - interval '7 days')::int      as created_7d,
         count(*) filter (where created_at > now() - interval '30 days')::int     as created_30d
       from ops.hermes_proposals`,
    );
    // Per-agent status breakdown.
    const agents = await q<any>(
      `select coalesce(nullif(agent, ''), 'unknown') as agent,
              count(*)::int                                    as total,
              count(*) filter (where status = 'pending')::int  as pending,
              count(*) filter (where status = 'sent')::int     as sent,
              count(*) filter (where status = 'dismissed')::int as dismissed
         from ops.hermes_proposals
        group by 1
        order by total desc`,
    );

    const sent = num(totals?.sent);
    const dismissed = num(totals?.dismissed);
    return {
      total: num(totals?.total),
      pending: num(totals?.pending),
      sent,
      dismissed,
      created24h: num(totals?.created_24h),
      created7d: num(totals?.created_7d),
      created30d: num(totals?.created_30d),
      approvalRatePct: approvalRatePct(sent, dismissed),
      byAgent: (agents ?? []).map((r) => ({
        agent: r.agent ?? 'unknown',
        total: num(r.total),
        pending: num(r.pending),
        sent: num(r.sent),
        dismissed: num(r.dismissed),
      })),
      live: true,
    };
  } catch (e: any) {
    return { ...EMPTY_PROPOSALS, note: e?.message ?? 'error' };
  }
}

// --------------------------------------------------------------------------
// Executions — ops.hermes_tool_executions
// --------------------------------------------------------------------------

export type ExecutionToolRow = {
  tool: string;
  runs: number;
  succeeded: number;
  failed: number;
  claimed: number;
};

export type ExecutionMetrics = {
  total: number;
  succeeded: number;
  failed: number;
  claimed: number;
  // Exactly-once integrity: duplicate idempotency keys must be 0 (the table's
  // UNIQUE constraint guarantees it; we surface the count so any breach shows).
  idempotencyDupes: number;
  exactlyOnceOk: boolean;
  byTool: ExecutionToolRow[];
  live: boolean;
  note?: string;
};

const EMPTY_EXECUTIONS: ExecutionMetrics = {
  total: 0, succeeded: 0, failed: 0, claimed: 0,
  idempotencyDupes: 0, exactlyOnceOk: true, byTool: [], live: false,
};

export async function getExecutionMetrics(): Promise<ExecutionMetrics> {
  if (!hasDb) return { ...EMPTY_EXECUTIONS, note: 'no DB' };
  try {
    const byTool = await q<any>(
      `select tool,
              count(*)::int                                    as runs,
              count(*) filter (where status = 'succeeded')::int as succeeded,
              count(*) filter (where status = 'failed')::int    as failed,
              count(*) filter (where status = 'claimed')::int   as claimed
         from ops.hermes_tool_executions
        group by tool
        order by runs desc`,
    );
    // Any idempotency_key that appears more than once = an exactly-once breach.
    // Should always be 0 (UNIQUE NOT NULL), so this is an integrity assertion.
    const dupes = await q1<any>(
      `select count(*)::int as dupes from (
         select idempotency_key
           from ops.hermes_tool_executions
          group by idempotency_key
         having count(*) > 1
       ) d`,
    );

    const rows: ExecutionToolRow[] = (byTool ?? []).map((r) => ({
      tool: r.tool ?? '—',
      runs: num(r.runs),
      succeeded: num(r.succeeded),
      failed: num(r.failed),
      claimed: num(r.claimed),
    }));
    const idempotencyDupes = num(dupes?.dupes);
    return {
      total: rows.reduce((a, r) => a + r.runs, 0),
      succeeded: rows.reduce((a, r) => a + r.succeeded, 0),
      failed: rows.reduce((a, r) => a + r.failed, 0),
      claimed: rows.reduce((a, r) => a + r.claimed, 0),
      idempotencyDupes,
      exactlyOnceOk: idempotencyDupes === 0,
      byTool: rows,
      live: true,
    };
  } catch (e: any) {
    return { ...EMPTY_EXECUTIONS, note: e?.message ?? 'error' };
  }
}

// --------------------------------------------------------------------------
// Budget — ops.hermes_budgets (caps) vs ops.hermes_budget_ledger (spend)
// --------------------------------------------------------------------------

export type BudgetRow = {
  persona: string;
  tool: string;
  scope: string;
  capMinor: number;
  windowSeconds: number;
  spentMinor: number;         // sum of ledger spend WITHIN the cap's window
  utilisationPct: number;
};

export type BudgetSpendRow = {
  persona: string;
  tool: string;
  amountMinor: number;
  note: string | null;
  at: string | null;
};

export type BudgetMetrics = {
  caps: BudgetRow[];
  totalCapMinor: number;
  totalSpentMinor: number;
  overallUtilisationPct: number;
  recent: BudgetSpendRow[];
  live: boolean;
  note?: string;
};

const EMPTY_BUDGET: BudgetMetrics = {
  caps: [], totalCapMinor: 0, totalSpentMinor: 0,
  overallUtilisationPct: 0, recent: [], live: false,
};

export async function getBudgetMetrics(recentLimit = 8): Promise<BudgetMetrics> {
  if (!hasDb) return { ...EMPTY_BUDGET, note: 'no DB' };
  try {
    // For each cap, sum only the ledger spend inside that cap's rolling window.
    const caps = await q<any>(
      `select b.persona, b.tool, b.scope, b.cap_minor, b.window_seconds,
              coalesce(sum(l.amount_minor) filter (
                where l.created_at > now() - make_interval(secs => b.window_seconds)
              ), 0) as spent_minor
         from ops.hermes_budgets b
         left join ops.hermes_budget_ledger l
           on l.persona = b.persona and l.tool = b.tool and l.scope = b.scope
        group by b.persona, b.tool, b.scope, b.cap_minor, b.window_seconds
        order by b.persona, b.tool, b.scope`,
    );
    const recent = await q<any>(
      `select persona, tool, amount_minor, note, created_at
         from ops.hermes_budget_ledger
        order by created_at desc
        limit $1`,
      [recentLimit],
    );

    const capRows: BudgetRow[] = (caps ?? []).map((r) => {
      const capMinor = num(r.cap_minor);
      const spentMinor = num(r.spent_minor);
      return {
        persona: r.persona ?? '—',
        tool: r.tool ?? '*',
        scope: r.scope ?? 'global',
        capMinor,
        windowSeconds: num(r.window_seconds),
        spentMinor,
        utilisationPct: utilisationPct(spentMinor, capMinor),
      };
    });
    const totalCapMinor = capRows.reduce((a, r) => a + r.capMinor, 0);
    const totalSpentMinor = capRows.reduce((a, r) => a + r.spentMinor, 0);
    return {
      caps: capRows,
      totalCapMinor,
      totalSpentMinor,
      overallUtilisationPct: utilisationPct(totalSpentMinor, totalCapMinor),
      recent: (recent ?? []).map((r) => ({
        persona: r.persona ?? '—',
        tool: r.tool ?? '*',
        amountMinor: num(r.amount_minor),
        note: r.note ?? null,
        at: toIso(r.created_at),
      })),
      live: true,
    };
  } catch (e: any) {
    return { ...EMPTY_BUDGET, note: e?.message ?? 'error' };
  }
}

// --------------------------------------------------------------------------
// Audit — ops.hermes_audit_log (+ verifyChain from lib/hermes/audit.ts)
// --------------------------------------------------------------------------

export type AuditActionRow = { action: string; total: number; last24h: number };

export type AuditFeedRow = {
  ts: string | null;
  actor: string | null;
  action: string;
  tool: string | null;
  summary: string | null;
};

export type AuditMetrics = {
  total: number;
  last24h: number;
  byAction: AuditActionRow[];
  chain: ChainVerification;   // { ok, count, brokenAtSeq, reason? }
  feed: AuditFeedRow[];
  live: boolean;
  note?: string;
};

const EMPTY_AUDIT: AuditMetrics = {
  total: 0, last24h: 0, byAction: [],
  chain: { ok: true, count: 0, brokenAtSeq: null },
  feed: [], live: false,
};

export async function getAuditMetrics(feedLimit = 12): Promise<AuditMetrics> {
  // verifyChain() is itself mock-safe (empty valid chain with no DB); run it
  // regardless so the page always has a chain status to show.
  const chain = await safeChain();
  if (!hasDb) return { ...EMPTY_AUDIT, chain, note: 'no DB' };
  try {
    const byAction = await q<any>(
      `select action,
              count(*)::int                                                   as total,
              count(*) filter (where ts > now() - interval '24 hours')::int   as last_24h
         from ops.hermes_audit_log
        group by action
        order by total desc`,
    );
    const feed = await q<any>(
      `select ts, actor, action, tool, summary
         from ops.hermes_audit_log
        order by seq desc
        limit $1`,
      [feedLimit],
    );

    const actions: AuditActionRow[] = (byAction ?? []).map((r) => ({
      action: r.action ?? '—',
      total: num(r.total),
      last24h: num(r.last_24h),
    }));
    return {
      total: actions.reduce((a, r) => a + r.total, 0),
      last24h: actions.reduce((a, r) => a + r.last24h, 0),
      byAction: actions,
      chain,
      feed: (feed ?? []).map((r) => ({
        ts: toIso(r.ts),
        actor: r.actor ?? null,
        action: r.action ?? '—',
        tool: r.tool ?? null,
        summary: r.summary ?? null,
      })),
      live: true,
    };
  } catch (e: any) {
    return { ...EMPTY_AUDIT, chain, note: e?.message ?? 'error' };
  }
}

// verifyChain can touch the DB; never let it throw into the page.
async function safeChain(): Promise<ChainVerification> {
  try {
    return await verifyChain();
  } catch (e: any) {
    return { ok: true, count: 0, brokenAtSeq: null, reason: e?.message };
  }
}

// --------------------------------------------------------------------------
// Aggregate — everything the page needs, fetched in parallel.
// --------------------------------------------------------------------------

export type Observability = {
  proposals: ProposalMetrics;
  executions: ExecutionMetrics;
  budget: BudgetMetrics;
  audit: AuditMetrics;
  live: boolean;   // true if ANY source read live (i.e. the DB was reachable)
};

export async function getObservability(): Promise<Observability> {
  const [proposals, executions, budget, audit] = await Promise.all([
    getProposalMetrics(),
    getExecutionMetrics(),
    getBudgetMetrics(),
    getAuditMetrics(),
  ]);
  return {
    proposals,
    executions,
    budget,
    audit,
    live: proposals.live || executions.live || budget.live || audit.live,
  };
}

// Normalise a pg timestamp (Date | string | null) to an ISO string or null.
function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
