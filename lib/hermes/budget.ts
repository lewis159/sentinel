// Budget caps for Hermes tool spend → ops.hermes_budgets + ops.hermes_budget_ledger.
//
// A cap is (persona, tool, scope) → cap_minor over a rolling window_seconds.
// checkBudget() sums the recorded spend inside the window and reports whether an
// estimated new spend would breach the cap; recordSpend() appends a ledger row
// after a spend actually happens. Amounts are MINOR currency units (pennies) to
// match the money-moving tools; a non-money cap can reuse cap_minor as a plain
// integer counter.
//
// Resolution: the most SPECIFIC cap wins — an exact (persona, tool) row beats a
// persona-wide (persona, '*') row. If no cap is configured the action is allowed
// (unlimited) and flagged as uncapped, so callers can decide to gate-by-default
// elsewhere.
//
// Mock-safe: with no DB, checkBudget allows everything (uncapped) and recordSpend
// is a no-op, so the dev/copilot path is never blocked by budgeting.
import { hasDb, q, q1 } from '@/lib/db';

export type BudgetDecision = {
  allowed: boolean;         // false → estSpend would breach the cap
  capMinor: number | null;  // the resolved cap, or null when uncapped
  spentMinor: number;       // spend already recorded inside the window
  estMinor: number;         // the estimate we were asked about
  remainingMinor: number | null; // cap - spent (null when uncapped)
  scope: string;
  tool: string;             // the resolved cap's tool ('*' when a persona-wide cap matched)
  windowSeconds: number | null;
  uncapped: boolean;        // true → no cap configured for this (persona,tool,scope)
  reason?: string;
};

type BudgetRow = {
  persona: string;
  tool: string;
  scope: string;
  cap_minor: string | number;
  window_seconds: number;
};

// Resolve the applicable cap: prefer an exact-tool row, else the persona-wide
// ('*') row, within the given scope. Returns null when neither exists.
async function resolveBudget(
  persona: string,
  tool: string,
  scope: string,
): Promise<BudgetRow | null> {
  const row = await q1<BudgetRow>(
    `select persona, tool, scope, cap_minor, window_seconds
       from ops.hermes_budgets
      where persona = $1 and scope = $3 and tool in ($2, '*')
      order by (tool = $2) desc   -- exact tool match first, then the '*' wildcard
      limit 1`,
    [persona, tool, scope],
  );
  return row ?? null;
}

/**
 * Would spending `estMinor` more breach the (persona, tool, scope) cap right now?
 * Sums ledger spend inside the resolved cap's rolling window and compares
 * spent + est against the cap. No cap configured → allowed + uncapped. No DB →
 * allowed + uncapped.
 */
export async function checkBudget(
  persona: string,
  tool: string,
  estMinor: number,
  scope = 'global',
): Promise<BudgetDecision> {
  const est = Number.isFinite(estMinor) ? Math.max(0, Math.trunc(estMinor)) : 0;
  const uncapped = (extra?: Partial<BudgetDecision>): BudgetDecision => ({
    allowed: true,
    capMinor: null,
    spentMinor: 0,
    estMinor: est,
    remainingMinor: null,
    scope,
    tool,
    windowSeconds: null,
    uncapped: true,
    ...extra,
  });

  if (!hasDb) return uncapped({ reason: 'no DB — uncapped' });

  const cap = await resolveBudget(persona, tool, scope);
  if (!cap) return uncapped({ reason: 'no budget configured' });

  const capMinor = Number(cap.cap_minor) || 0;
  const windowSeconds = Number(cap.window_seconds) || 86400;

  // Sum spend inside the window for the SAME cap grain (persona, scope, and the
  // cap's tool — '*' sums all tools for the persona-wide cap).
  const toolPredicate = cap.tool === '*' ? '' : 'and tool = $2';
  const params: any[] = cap.tool === '*' ? [persona, scope, windowSeconds] : [persona, cap.tool, scope, windowSeconds];
  // Renumber params depending on whether the tool predicate is present.
  const sql =
    cap.tool === '*'
      ? `select coalesce(sum(amount_minor), 0)::bigint as spent
           from ops.hermes_budget_ledger
          where persona = $1 and scope = $2
            and created_at >= now() - make_interval(secs => $3)`
      : `select coalesce(sum(amount_minor), 0)::bigint as spent
           from ops.hermes_budget_ledger
          where persona = $1 and tool = $2 and scope = $3
            and created_at >= now() - make_interval(secs => $4)`;

  const spentRow = await q1<{ spent: string | number }>(sql, params);
  const spentMinor = Number(spentRow?.spent ?? 0) || 0;
  const remainingMinor = capMinor - spentMinor;
  const allowed = spentMinor + est <= capMinor;

  return {
    allowed,
    capMinor,
    spentMinor,
    estMinor: est,
    remainingMinor,
    scope,
    tool: cap.tool,
    windowSeconds,
    uncapped: false,
    reason: allowed
      ? undefined
      : `cap ${capMinor} would be exceeded (spent ${spentMinor} + est ${est})`,
  };
}

/**
 * Append a spend to the ledger after a tool actually spent. No-op with no DB.
 * `tool` should be the concrete tool that spent — a persona-wide cap still sums
 * it via its '*' grain, and an exact cap matches it directly.
 */
export async function recordSpend(
  persona: string,
  tool: string,
  amountMinor: number,
  opts?: { scope?: string; proposalId?: string | null; note?: string | null },
): Promise<void> {
  if (!hasDb) return;
  const amount = Number.isFinite(amountMinor) ? Math.trunc(amountMinor) : 0;
  await q(
    `insert into ops.hermes_budget_ledger (persona, tool, scope, amount_minor, proposal_id, note)
     values ($1, $2, $3, $4, $5, $6)`,
    [persona, tool, opts?.scope ?? 'global', amount, opts?.proposalId ?? null, opts?.note ?? null],
  );
}
