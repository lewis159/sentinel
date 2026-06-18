# Error Codes & Messages

_Living document — reflects the current build; re-verify after changes._

## Purpose

A single reference for the error messages, notes and failure states Sentinel and its stack can
produce — what each means and how to fix it. Notes like `no DB` appear as the `note` field on a
data read and as the reason the **live** badge is absent. For walkthroughs see
[Troubleshooting](./troubleshooting.md).

![Error codes — data-source notes and stack states](./images/error-codes-ref.png)

## Application data-source notes

These come from `lib/data.ts` / `lib/connectors.ts` / `lib/docker.ts` and surface as the read
`note`.

| Code / message | Where | Meaning | Fix |
|----------------|-------|---------|-----|
| `no DB` | findings, tickets, components, writes | `DATABASE_URL` unset (`hasDb=false`) | Set `DATABASE_URL`; check `sentinel-db` |
| `empty` | findings, tickets, components | DB reachable but table has 0 rows | Run a scan / seed the table |
| `no connector` | users, platform stats | No enabled, fully-configured Supabase connector | Settings → Connectors: add URL + key, enable |
| `no users` | user audit | Supabase `users` query returned 0 rows | Verify source data / key scope |
| `unconfigured` | connector status | Saved `config.url` is missing | Re-enter the connection URL |
| `<supabase error>` | users, stats, connector test | Raw Supabase error | Fix URL/key/RLS/network; re-test |

## Database (Postgres) errors

| Message | Meaning | Fix |
|---------|---------|-----|
| `permission denied for schema ops` | DB role connected but lacks rights on `ops` | `GRANT USAGE ON SCHEMA ops`, `GRANT SELECT/INSERT/UPDATE ON ALL TABLES IN SCHEMA ops` to the app role |
| `relation "ops.findings" does not exist` (and similar) | Schema not migrated | Run migrations to create the `ops` schema |
| `finding SEC-#### not found` | *Raise ticket* on a missing finding | Refresh; the finding may be purged |
| `insert failed` | Ticket insert returned no row | Check `ops.tickets` sequence/constraints |
| connection refused / `ECONNREFUSED` | DB container down or wrong host/port | Start `sentinel-db`; verify `DATABASE_URL` |
| connection terminated / timeout | Failover in progress or pool exhausted | Wait for HAProxy to route to new primary; check pool `max` |

## Docker / socket-proxy errors

| Message | Meaning | Fix |
|---------|---------|-----|
| `DOCKER_HOST not configured` | No TCP endpoint (`hasDocker=false`) | Set `DOCKER_HOST=tcp://docker-socket-proxy:2375` |
| `docker API timeout` | Proxy did not respond within 4s | Check proxy container & network |
| `docker API 4xx for <path>` | Path not on the proxy read allow-list | Enable the needed read endpoint on the proxy |
| `docker API 5xx for <path>` | Docker daemon errored | Check daemon health on the node |
| "Docker socket unavailable" | Proxy can't reach the daemon socket | Verify the proxy's socket mount & permissions |

## Connector / integration test failures

| Message | Meaning | Fix |
|---------|---------|-----|
| `channel test failed` | Notification channel unreachable | Re-check creds in Settings → Channels |
| `AI draft unavailable` | Hermes AI integration not reachable | Verify Settings → Integrations endpoint/key |
| `report generation failed` | Report render pipeline error | Check source markdown / brand assets / logs |

## HA cluster states (Patroni / HAProxy / etcd)

| State / message | Meaning | Action |
|-----------------|---------|--------|
| Patroni role `Leader` | The current primary | Normal — writes go here |
| Patroni role `Replica` | Streaming standby | Normal — read-only |
| `failover`/`switchover` in progress | Primary changing | Brief write pause; HAProxy re-routes — wait it out |
| HAProxy backend `DOWN` for primary | Primary node unhealthy | Patroni promotes a replica; confirm new leader |
| `no leader` / split-brain risk | etcd quorum lost | Restore etcd quorum (need majority of nodes) before promoting |
| Replica `lag` high | Standby behind primary | Investigate I/O/network; avoid promoting a lagging replica |

See the [HA Runbook](./ha-runbook.md) for the procedures behind these states.

## Auth (Clerk) errors

| Message / route | Meaning | Fix |
|-----------------|---------|-----|
| Redirect to `/sign-in` | Not authenticated | Sign in (invite-only) |
| `/unauthorized` (403) | Signed in but not permitted | Grant the operator a console role in Settings → Roles |

## Webhook-in ingest (`POST /api/ops/ingest/<source>`)

The webhook-in path lets external / CI scanners (npm-audit, gitleaks, trivy) push
real findings into `ops.findings`. It is the complement to the worker's in-network
header scan. Requests are authenticated with an HMAC over the **raw** request body.

| Status / body | Meaning | Fix |
|---------------|---------|-----|
| `503 { error: 'ingest not configured' }` | `OPS_INGEST_SECRET` is unset on the Sentinel app | Set `OPS_INGEST_SECRET` env on the app/container and the matching GitHub secret |
| `401 { error: 'invalid signature' }` | `x-ingest-signature` missing, or HMAC-SHA256(body, secret) ≠ header | Ensure the CI secret matches the app's `OPS_INGEST_SECRET`; sign the exact bytes sent (`--data-binary @payload.json`) |
| `503 { error: 'no DB' }` | Signature ok but `DATABASE_URL` unset (`hasDb=false`) | Set `DATABASE_URL`; check `sentinel-db` |
| `400 { error: 'invalid JSON body' }` | Body is not valid JSON | Send `{ "findings": [ … ] }` |
| `500 { ok:false, error }` | Upsert/reconcile failed (see message) | Check the message against the Postgres errors above |
| `200 { ok:true, upserted:N, resolved:M }` | Success — `N` rows upserted, `M` stale findings self-healed to `fixed` | — |

Notes:
- Findings are keyed on the UNIQUE `fingerprint`. If the client omits it, the route
  derives `sha256(source + ':' + cwe + ':' + component + ':' + title)`.
- **Self-heal:** after a non-empty batch, any auto-managed, non-`override_locked`
  finding of that `source` whose fingerprint was *not* in the payload is set to
  `status='fixed', resolved_at=now()`. An empty/failed scan (0 findings) does
  **not** mass-close — guards against a broken scanner wiping the board.

## SSL / `pg_hba` and parameter-type issues (resolved)

These were hit while wiring the ingest route and live reads against the Patroni/Spilo cluster.

| Message | Meaning | Fix |
|---------|---------|-----|
| `no encryption` / `no pg_hba.conf entry for host …, no encryption` | Patroni/Spilo only accepts `hostssl`; the client connected without TLS | Connect with SSL. `lib/db.ts` sets `ssl: { rejectUnauthorized: false }` (self-signed cert); only set `PGSSL=disable` for a plain local Postgres |
| `self-signed certificate` / `unable to verify the first certificate` | Node rejected the cluster's self-signed cert | Use `rejectUnauthorized: false` (already the default in `lib/db.ts`) — do **not** disable SSL entirely |
| `inconsistent types deduced for parameter $N` (e.g. `bigint` vs `text`) | A bound param was used in two contexts Postgres couldn't unify — common in the reconcile `... = any($2)` and `count(*)::text` query | Cast the placeholder explicitly: `$2::text[]`, `$5::jsonb`, `count(*)::text`. The ingest route casts `any($2::text[])` and the evidence param `$9::jsonb` for exactly this reason |
