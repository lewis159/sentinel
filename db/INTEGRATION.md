# Hermes P3 Safety Substrate — Integration Contract

This document is the wiring contract for the **P3 safety substrate**. The
substrate ships as a migration + three standalone libraries that are **built but
UNWIRED** — no brain hotspot file (`lib/hermes/proposals.ts`,
`lib/hermes/brain/graph.ts`, `lib/hermes/brain/copilot.ts`) was modified, because
those are edited concurrently by other agents. A later consolidation pass hooks
the libraries in at the exact points listed below.

## Artifacts shipped (all additive)

| Artifact | What it is |
| --- | --- |
| `db/init/15_hermes_p3_substrate.sql` | Migration: audit log, exec ledger, budgets, tenant RLS policy (RLS left OFF). |
| `lib/hermes/audit.ts` | `appendAudit(entry)`, `verifyChain()`, `computeRowHash(...)`. |
| `lib/hermes/exec-ledger.ts` | `claimExecution(key, proposalId, tool)`, `recordResult(...)`, `getExecution(...)`. |
| `lib/hermes/budget.ts` | `checkBudget(persona, tool, estMinor, scope?)`, `recordSpend(...)`. |

All libraries are **mock-safe**: with no `DATABASE_URL` (`hasDb === false`) they
degrade to a safe no-op (audit returns an in-memory hash, claim wins by default,
budget is uncapped) so dev/unit paths never break.

---

## (1) `lib/hermes/proposals.ts` → `actOnProposal` — claim + audit

`actOnProposal(id, action, by)` is the approve/dismiss path. Two hooks:

### 1a. Exactly-once around the gated tool execution
In the `action === 'approve'` **AND** `isAction` branch — currently around the
`resumeThread(...)` call (proposals.ts ~L252–266) — wrap the resume with a claim:

```ts
import { claimExecution, recordResult } from '@/lib/hermes/exec-ledger';

// idempotency key = proposal id + the pending tool call id (stable per approval).
const idemKey = `${id}:${proposal.action!.callId ?? proposal.action!.tool}`;
const claim = await claimExecution(idemKey, id, proposal.action!.tool);
if (!claim.won) {
  return { ok: false, error: 'this proposal was already executed' };
}
const res = await resumeThread({ threadId: proposal.action!.threadId, decision: { approved: true, by } });
await recordResult(idemKey, res.status === 'error' ? 'failed' : 'succeeded', res.toolResult ?? null);
```

This makes a double-approve / retried request safe: the second caller loses the
claim and does **not** re-run the money/account tool.

### 1b. Audit every decision
Append to the immutable log at each terminal outcome — after a successful
execute, after a plain approve (draft posted), after mark-sent, and after
dismiss:

```ts
import { appendAudit } from '@/lib/hermes/audit';

await appendAudit({
  actor: by,
  action: 'proposal.executed',              // or 'approved' | 'dismissed'
  proposalId: id,
  tenantRef: rec.tenant_ref ?? null,        // if resolvable from the proposal/ticket
  tool: proposal.action?.tool ?? null,
  summary: `Approved & executed ${proposal.action?.tool ?? 'proposal'} by ${by}`,
  detail: { action, result: proposal.action?.result ?? null },
});
```

Also append `action: 'proposal.created'` from `saveProposal` / `saveActionProposal`
when a proposal is first persisted, so the chain covers the full lifecycle.

## (2) `lib/hermes/brain/graph.ts` → `toolsNode` PHASE 2 — budget check + spend

The tool-execution sites are the two `c.tool.run(c.args, ctx)` calls in **PHASE 2**
of `toolsNode` (graph.ts ~L181 for approved-gated, ~L189 for auto). Before a
side-effecting/spending tool runs, gate on the budget; after it succeeds, record
the spend:

```ts
import { checkBudget, recordSpend } from '@/lib/hermes/budget';

// estMinor comes from the tool's own cost estimate (e.g. a refund amount in
// pennies). Non-spending read tools can skip this entirely.
const est = c.tool.estimateMinor ? c.tool.estimateMinor(c.args) : 0;
if (est > 0) {
  const b = await checkBudget(persona_id, c.name, est);
  if (!b.allowed) {
    out.push({ role: 'tool', tool_call_id: c.id,
      content: `NOT executed — ${persona_id} budget cap reached (${b.reason}). Escalate to a human.` });
    continue;
  }
}
const result = await c.tool.run(c.args, ctx);
if (result.ok && est > 0) {
  await recordSpend(persona_id, c.name, est, { note: c.name });
}
```

`checkBudget` resolves the most specific cap (exact `(persona, tool)` beats a
persona-wide `(persona, '*')` cap) and sums ledger spend inside the cap's rolling
window. No cap configured → allowed + `uncapped:true`.

> Note: `copilot.ts` is draft-only for the five department personas (they never
> execute), so it needs no exec-ledger/budget hook — only `graph.ts` executes
> tools. If a copilot ever gains an executing tool, apply the same PHASE-2 pattern.

## (3) Tenant RLS — GUCs the app must set + enable steps

The migration **creates the policy but leaves RLS DISABLED** on `ops.tickets`
(see `05_disable_ops_rls.sql` — the operator console runs unscoped reads as
`sentinel_app`, so naive RLS would deny-all). Enabling is a deliberate, separate
step and MUST NOT be turned on until the app sets the request-local GUCs on
**every** DB request.

### Per-request GUCs (set before any query, per connection/transaction)
- **Operator / global_admin surfaces:** `SET app.is_operator = 'on';`
  → policy returns **all** rows (full-estate read preserved).
- **Tenant / customer-facing surfaces:** `SET app.tenant_ref = '<clerk_org_id>';`
  (and do **not** set `app.is_operator`) → policy returns **only**
  `tenant_ref = '<clerk_org_id>'`.

Because the policy uses `current_setting('app.is_operator', true)` /
`current_setting('app.tenant_ref', true)` (the `true` = missing-ok), a request
that forgets to set a GUC is **fail-closed** (0 rows) rather than leaking — once
RLS is on. Prefer setting the GUC per-transaction with `set_config('app.tenant_ref', $1, true)`
(local scope) since the pg pool reuses connections.

### Enable steps (run only after the app is confirmed to set the GUCs)
```sql
-- 1. Verify the app sets app.is_operator / app.tenant_ref on every request path.
-- 2. Then, in a maintenance window:
alter table ops.tickets enable row level security;
alter table ops.tickets force  row level security;  -- optional: also enforce for the table owner
-- The policy `hermes_tickets_tenant_isolation` is already present.
-- To roll back: alter table ops.tickets disable row level security;
```

RLS is **NOT auto-on** by design — enabling it without the GUC wiring will break
every unscoped operator query.

## (4) New env / config

- **None required.** All libraries key off the existing `DATABASE_URL` / `hasDb`.
- Budgets seed conservative daily caps (`pa` £50, `billing` £15, `support` £10)
  in the migration; tune via the governance settings surface by upserting
  `ops.hermes_budgets` rows (`ON CONFLICT (persona, tool, scope)`).
- No feature flag gates the substrate; wiring it in (sections 1–2) is what makes
  it live. Section 3 (RLS) is separately gated by the manual enable step.

---

## Table reference (schema in `15_hermes_p3_substrate.sql`)

- **`ops.hermes_audit_log`** — `seq` (identity, chain order), `id`, `ts`, `actor`,
  `action` (`proposal.created|approved|dismissed|executed`), `proposal_id`
  (→`ops.hermes_proposals`), `tenant_ref`, `tool`, `summary`, `detail` jsonb,
  `prev_hash`, `row_hash`. Append-only: BEFORE UPDATE/DELETE trigger raises +
  `REVOKE UPDATE,DELETE`.
- **`ops.hermes_tool_executions`** — `id`, `proposal_id`, `tool`,
  `idempotency_key` **UNIQUE NOT NULL** (the exactly-once gate), `status`
  (`claimed|succeeded|failed`), `result` jsonb, `created_at`, `updated_at`.
- **`ops.hermes_budgets`** — PK `(persona, tool, scope)`, `cap_minor`,
  `window_seconds`. `tool='*'` = persona-wide.
- **`ops.hermes_budget_ledger`** — `persona`, `tool`, `scope`, `amount_minor`,
  `proposal_id`, `note`, `created_at`. Summed within the window by `checkBudget`.
