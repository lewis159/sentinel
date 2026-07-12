# DB-backed integration tests

These tests run the Hermes safety **spine** against a **real Postgres** — not
mocks. They complement the pure-logic unit tests in `tests/unit/` (which mock
`@/lib/db`). The suite only does real work when `DATABASE_URL` is set; with no
`DATABASE_URL` it **skips cleanly** (a green no-op), so it never breaks a machine
without a database.

## What's covered

| File | Real behaviour asserted |
| --- | --- |
| `spine.test.ts` | `saveActionProposal` writes a real `ops.hermes_proposals` row (+ `proposal.created` audit); a **double-approve** of the same proposal runs the gated tool **exactly once** — arbitrated by the real `ops.hermes_tool_executions` `UNIQUE(idempotency_key)` ledger. Only `resumeThread` (the tool execution) and `server-only`/`addTicketComment` are stubbed. |
| `budget.test.ts` | `checkBudget`/`recordSpend` enforce a seeded `(persona,'*',scope)` cap across the real `ops.hermes_budgets` + `ops.hermes_budget_ledger`; the window-summed gate flips `allowed`→false at the cap boundary. |
| `audit.test.ts` | `appendAudit` writes a hash-chained log and `verifyChain()` passes; a retroactive `UPDATE`/`DELETE` is **rejected** by the append-only trigger on `ops.hermes_audit_log`. |
| `rls.test.ts` | Applies migration 17 (enable + force RLS), turns on `HERMES_RLS_ENABLED`, then drives `withTenantRls`: an **operator** GUC sees all `ops.tickets`; a **tenant** GUC sees only its own; **no identity** sees zero rows (fail-closed). Cleanup disables RLS again. |

## Run it locally

```bash
# 1. Start a throwaway pgvector Postgres (loads db/init/01..17 on first boot).
docker compose -f docker-compose.test.yml up -d

# 2. Point the suite at it and run.
DATABASE_URL=postgres://sentinel:sentinel@localhost:5433/sentinel_test \
  PGSSL=disable HERMES_RLS_ENABLED=1 \
  npm run test:integration

# 3. Tear down (‑v also wipes the data volume for a clean next run).
docker compose -f docker-compose.test.yml down -v
```

`PGSSL=disable` is required because the local/CI Postgres has no TLS (the prod
Patroni cluster does, which is `lib/db.ts`'s default). `HERMES_RLS_ENABLED=1`
lets the RLS suite exercise the real policy; the other suites ignore it.

## Notes

- **Schema bootstrap:** if you point `DATABASE_URL` at a *bare* Postgres (no
  `db/init` mount), `global-setup.ts` loads `db/init/01..17` for you on first run
  and no-ops if the schema is already present.
- **pgvector:** migration 13 needs the `vector` extension. Use
  `pgvector/pgvector:pg16` (the compose/CI image). On a plain `postgres:16`,
  `global-setup.ts` skips migration 13 with a warning (no integration test uses
  the KB store).
- **Shared DB, serial files:** the suite runs files serially
  (`fileParallelism: false`) because they share one database and the RLS file
  toggles row-level security on `ops.tickets`.
