// Exactly-once execution ledger for Hermes tool side-effects → the table
// ops.hermes_tool_executions.
//
// The problem: the Approve path (actOnProposal) resumes a paused Brain graph and
// runs a gated tool for real. If that request is retried, double-submitted, or
// two operators approve the same proposal at once, the money-moving / account
// tool must run AT MOST ONCE.
//
// The gate: every intended execution is keyed by a caller-chosen idempotency_key
// that is UNIQUE NOT NULL. claimExecution does
//   INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
// Under any concurrency exactly one INSERT wins and RETURNs its id; every
// duplicate conflicts and RETURNs no row. So "did a row come back?" IS the
// exactly-once decision — the winner runs the tool, the losers stand down. This
// is airtight because the arbitration is the DB's UNIQUE index, evaluated
// atomically per INSERT; there is no read-modify-write window to race.
//
// Mock-safe: with no DB, claimExecution reports `won: true` (single-process dev
// has no concurrency to arbitrate) so the dev/copilot path still executes once.
import { hasDb, q1 } from '@/lib/db';

export type ExecStatus = 'claimed' | 'succeeded' | 'failed';

export type ClaimResult = {
  // Did THIS caller win the claim (and therefore must run the tool)?
  won: boolean;
  // The execution row id (present when we won, or when we looked up an existing
  // claim). Null only in the no-DB path.
  id: string | null;
  // True when the key was already claimed by someone else (we lost).
  alreadyClaimed: boolean;
};

/**
 * Atomically claim the right to execute `tool` under `idempotencyKey`.
 *   - won:true            → you won the race; run the tool, then recordResult().
 *   - won:false + already → someone already claimed this key; DO NOT run.
 *
 * The claim is INSERT ... ON CONFLICT DO NOTHING RETURNING id: a returned row
 * means this INSERT created it (we won); no row means the unique key already
 * existed (we lost). No DB → won:true (nothing to arbitrate in single-process dev).
 */
export async function claimExecution(
  idempotencyKey: string,
  proposalId: string | null,
  tool: string,
): Promise<ClaimResult> {
  if (!hasDb) return { won: true, id: null, alreadyClaimed: false };

  const inserted = await q1<{ id: string }>(
    `insert into ops.hermes_tool_executions (proposal_id, tool, idempotency_key, status)
     values ($1, $2, $3, 'claimed')
     on conflict (idempotency_key) do nothing
     returning id`,
    [proposalId, tool, idempotencyKey],
  );

  if (inserted?.id) {
    // We created the row → we won.
    return { won: true, id: inserted.id, alreadyClaimed: false };
  }

  // Conflict: the key already exists → someone else owns this execution. Surface
  // the existing id for correlation, but we did NOT win.
  const existing = await q1<{ id: string }>(
    'select id from ops.hermes_tool_executions where idempotency_key = $1',
    [idempotencyKey],
  );
  return { won: false, id: existing?.id ?? null, alreadyClaimed: true };
}

/**
 * Record the outcome of an execution we WON. Updates status + result for the row
 * matching the idempotency_key. No-op with no DB.
 */
export async function recordResult(
  idempotencyKey: string,
  status: Exclude<ExecStatus, 'claimed'>,
  result?: Record<string, unknown> | null,
): Promise<void> {
  if (!hasDb) return;
  await q1(
    `update ops.hermes_tool_executions
        set status = $2, result = $3::jsonb, updated_at = now()
      where idempotency_key = $1`,
    [idempotencyKey, status, result == null ? null : JSON.stringify(result)],
  );
}

/**
 * Look up an existing execution by idempotency key (for correlation / audit).
 * Null with no DB or when not found.
 */
export async function getExecution(idempotencyKey: string): Promise<{
  id: string;
  tool: string;
  status: ExecStatus;
  result: Record<string, unknown> | null;
} | null> {
  if (!hasDb) return null;
  const row = await q1<any>(
    'select id, tool, status, result from ops.hermes_tool_executions where idempotency_key = $1',
    [idempotencyKey],
  );
  if (!row) return null;
  return {
    id: row.id,
    tool: row.tool,
    status: (row.status ?? 'claimed') as ExecStatus,
    result: typeof row.result === 'string' ? safeParse(row.result) : (row.result ?? null),
  };
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
