# Troubleshooting

_Living document — reflects the current build; re-verify after changes._

## Purpose

Cross-cutting issues that affect Sentinel as a whole, and how to fix them. For page-specific
notes see each entity article; for the full message reference see [Error Codes](./error-codes.md).

![Troubleshooting — live badge and data-source notes](./images/troubleshooting-badges.png)

## First principle: the "live" badge

Every data read returns `{ rows, live, note }`. If a source is down or empty, Sentinel renders
**mock** data, drops the **live** badge, and attaches a `note` explaining why (`no DB`,
`empty`, `no connector`, or the raw error). So your first diagnostic is always: **is there a
live badge, and what does the note say?**

## 1. Database (Sentinel's own Postgres) is down

**Symptoms:** Findings/Tickets/Components/Graph all show demo data; notes say `no DB` or a
connection error; writes (*Raise ticket*, status override) throw `no DB`.

**Checks & fixes:**
- Confirm `DATABASE_URL` is set and reaches the app (`hasDb` in `lib/db.ts`).
- Confirm the `sentinel-db` container is healthy and accepting connections.
- In HA, the primary may be failing over — see the [HA Runbook](./ha-runbook.md); HAProxy
  should route to the new primary within seconds.
- If you see `permission denied for schema ops`, the DB role is connected but lacks rights —
  grant on schema `ops` (see [Error Codes](./error-codes.md)).

## 2. Connector misconfigured (no live platform/user data)

**Symptoms:** User Audit and Overview platform stats show demo data; note says `no connector`,
`no users`, or a Supabase error.

**Checks & fixes:**
- Go to [Settings → Connectors](./settings-connectors.md). The Supabase connector must be
  **enabled** and have **both** `url` and `key` — `getSupabase()` returns `null` otherwise.
- Use **Test**: the error shown is the raw Supabase message (bad URL/key, RLS blocking the
  role, or network). Ensure the key can read `users`.
- Status `unconfigured` means `config.url` is missing — re-enter it.

## 3. Docker socket-proxy unreachable (no live containers)

**Symptoms:** Infra shows mock containers / no live badge; Scans capacity & uptime checks have
no live data; notes/logs show `docker API timeout` or `DOCKER_HOST not configured`.

**Checks & fixes:**
- `DOCKER_HOST` must be set and start with `tcp://` (e.g. `tcp://docker-socket-proxy:2375`);
  `hasDocker` is false otherwise (`lib/docker.ts`).
- Confirm the **docker-socket-proxy** container is up and on the same network as the app.
- The client times out after **4s**; a slow/unreachable proxy yields `docker API timeout`.
- A `docker API 4xx` usually means the path is not on the proxy's read allow-list; `5xx`
  means the Docker daemon itself errored.
- Remember: CPU/Mem are always `0` (the `/stats` endpoint is out of scope) — that is expected,
  not a fault.

## 4. Empty live data (DB up, but nothing shows)

**Symptoms:** Live badge logic reports `empty`; lists are blank or fall back to mock.

**Checks & fixes:**
- The relevant `ops` table has 0 rows. Findings/tickets are produced by **scan runs** — go to
  [Scans](./scans.md) and *Run all* to populate.
- Components/KB may need seeding/authoring.
- Confirm the worker is running and consuming `ops.jobs`; without it, scans never produce rows.

## 5. Build failures

**Symptoms:** Image won't build, dev server slow, or pages render demo data despite a DB.

**Checks & fixes:**
- Build on the **C: drive** (`C:\dev\sentinel\code`), not the Z: design copy — see
  [Build Process](./build-process.md).
- Ensure migrations created the `ops` schema and the DB role has rights.
- Verify `DATABASE_URL` / `DOCKER_HOST` are injected by the stack into the **app** container.
- Watch for connection leaks: the pool is cached on `global._sentinelPool` for hot-reload.

## 6. Relationships/links missing (sparse Graph or empty Links panel)

- Edges in `ops.links` are created when you act (*Raise ticket* writes `raises`; linking KB/
  components writes their edges). Back-fill missing links from either entity. See [Graph](./graph.md).

## When to escalate to an incident

If a DB failover, proxy outage, or worker outage is causing broad data loss, declare an
**[incident](./incidents.md)** so the timeline and post-mortem capture the response.
