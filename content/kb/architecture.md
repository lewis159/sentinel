# Architecture

_Living document — reflects the current build; re-verify after changes._

## Purpose

This article describes how Sentinel is put together: the app, its own database, how it reads
external systems and Docker, and the data flow that turns raw signals into findings, tickets
and alerts.

![Architecture — app, worker, Postgres, socket-proxy, connectors](./images/architecture-overview.png)

## The big picture

Sentinel is a **single-pane Operations & Security Console** built as a Next.js app with two
workspaces — **Security** and **Operations** — sharing one shell, one command palette, and
one relationship graph. It is **invite-only** (Clerk auth; no public sign-up).

Three moving parts:

1. **App (Next.js)** — renders every page, reads data, performs server-only writes.
2. **Worker** — a job-queue pool that runs scans/checks, writes container snapshots and
   findings, and evaluates alert rules.
3. **Sentinel Postgres** — Sentinel's own local database (the `sentinel-db` container),
   holding everything in the **`ops`** schema plus a `public.connectors` table.

External systems are reached two ways, both **without baking secrets into env**:

- **Connectors** (`public.connectors`) — e.g. the YT Transcriber **Supabase** source for
  platform users/videos/transcripts. Configured in [Settings → Connectors](./settings-connectors.md).
- **docker-socket-proxy** — a **read-only** Docker Engine API proxy. The app never touches
  the raw Docker socket (that exposure is the very risk Sentinel flags as `SEC-0009`).

## Data flow

```
  scans (worker) --> ops.findings --> Findings UI
        |                  |
        |                  +- raise --> ops.tickets --> Tickets UI
        |                                   |
  rules --> ops.alerts --> Alerts UI --> ops (incidents) --> Incidents UI
        |
  docker-socket-proxy --> live containers --> Infra UI
        |                                  +- ops.container_snapshots (capacity history)
  Supabase connector --> platform users/stats --> User Audit / Overview
        |
  ops.links <-- relationships among all of the above --> Graph + Links panels
```

Every cross-entity relationship is a row in **`ops.links`**, which powers the per-page
**Links panel**, the **traversal trail**, and the global **[Graph](./graph.md)**.

## The `ops` schema

| Table | Holds |
|-------|-------|
| `ops.findings` | Security results — ref, title, description, severity, cvss, cwe, component_label, source, status, first_seen_at, last_seen_at, override_locked |
| `ops.tickets` | Work items — ref, title, type, status, priority, source, opened_at, created_at |
| `ops.comments` | Comments/activity on tickets & incidents |
| `ops.links` | The relationship graph — src_type, src_id, relation, dst_type, dst_id |
| `ops.components` | Service/component inventory |
| `ops.container_snapshots` | Capacity/stats history written by the worker |
| `ops.rules` | Check definitions and alert rules (schedule, trigger, action) |
| `ops.alerts` | Firing/acknowledged/resolved alerts, grouped by dedup key |
| `ops.jobs` | The scan/worker job queue and run records |
| `ops.kb` | Knowledge Base articles / runbooks |

Plus `public.connectors` — external data-source configuration (see Connectors).

## Read paths (where to look in code)

| Concern | Module |
|---------|--------|
| Sentinel Postgres pool & query helpers (q, q1, hasDb) | `lib/db.ts` |
| Findings/tickets/links/users/stats access + mock fallback | `lib/data.ts` |
| Connector config & Supabase client (getSupabase, saveConnector) | `lib/connectors.ts` |
| Read-only Docker Engine client over the proxy (getContainers, hasDocker) | `lib/docker.ts` |
| Navigation / workspace model | `lib/nav.ts` |
| Mock fallback data | `lib/mock.ts` |

## Resilience model

Every read returns `{ rows, live }`. When a data source is unreachable or empty, the page
renders **mock** data and `live=false` (a note explains why: `no DB`, `empty`, `no connector`,
or the raw error). The console therefore always renders; the **live** badge tells you whether
you are looking at reality. See [Troubleshooting](./troubleshooting.md).

## High availability

For production the single Postgres becomes a **Patroni (Spilo) + etcd + HAProxy** cluster,
the app runs as **replicas behind a load balancer**, the worker becomes a **job-queue pool**,
and the socket-proxy is **global**. See the [HA Runbook](./ha-runbook.md) and
[Build Process](./build-process.md).

## Common tasks

- **Trace a value to its source:** use the read-paths table to find the function and SQL.
- **Add an external source:** add a connector (do not add env secrets).
- **Understand a relationship:** it is a row in `ops.links` — inspect via Graph.

## Troubleshooting / Error codes

See [Troubleshooting](./troubleshooting.md) and [Error Codes](./error-codes.md) for the
cross-cutting failure modes (DB down, connector misconfig, socket-proxy unreachable, empty
live data).
