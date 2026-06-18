# Scans & Checks

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Scans & Checks** (route `/scans`) is the detection engine that feeds Findings. It is a
catalogue of **checks** — each a specific test (dependency audit, secret scan, image/CVE,
HTTP headers/TLS, access/auth audit, abuse/multi-account, container capacity, uptime) —
plus their schedules, last-run status, and the findings they produce. It appears in both
workspaces (security checks and ops checks).

![Scan catalogue — checks, schedules, last run, findings count](./images/scans-catalogue.png)

## How to use it

- **Catalogue** (`/scans`) — every check shows type · schedule · last run · status
  (pass / issues / failed) · number of findings. Use **Run all** or **Run now**.
- **Check detail** (`/scans/checks/[key]`) — the check's config, schedule, run history, and
  the findings it currently owns.
- **Run history** (`/scans/runs`) and **run detail** (`/scans/runs/[id]`) — what each run
  found, duration, pass/fail, and integrity.

### Built-in checks (current build)

| Key | Name | Type | Schedule |
|-----|------|------|----------|
| `npm-audit` | Dependency audit | security | on push + nightly |
| `gitleaks` | Secret scan | security | on push |
| `trivy` | Image / container CVE | security | on build |
| `headers` | HTTP headers / TLS | security | every 6h |
| `access-audit` | Access / auth audit | security | daily |
| `abuse` | Abuse / multi-account | security | hourly |
| `capacity` | Container capacity | ops | every 60s |
| `uptime` | Uptime | ops | every 30s |

## How it works (technical)

Checks are defined in `ops.rules` (schedule, type, config) and each execution is a row in
`ops.jobs`. The **worker** pool pulls jobs from the queue, runs the check, writes any
results into `ops.findings` (and capacity/abuse signals), and records the run. Container
capacity/uptime checks read live container state through the read-only
**docker-socket-proxy** (`lib/docker.ts`); the abuse check reads platform users via the
Supabase **connector**.

## Common tasks

- **Force a fresh scan:** `/scans` → *Run all* (or *Run now* on one check).
- **Investigate a noisy check:** open the check → run history → a specific run.
- **Tune a schedule:** Settings → Schedules (`/settings/schedules`).

## Troubleshooting

- **Capacity / uptime checks show no live data** — the socket-proxy is unreachable or
  `DOCKER_HOST` isn't `tcp://…`; see [Infra](./infra.md) and [Troubleshooting](./troubleshooting.md).
- **Abuse check finds nothing** — the Supabase connector is missing/disabled.
- **A check is stuck** — its job may be queued but no worker is consuming; check the worker
  pool (see [Build Process](./build-process.md)).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `docker API timeout` | socket-proxy didn't respond in 4s | Check proxy container / network |
| `docker API 4xx/5xx for <path>` | Engine API error via proxy | Verify proxy allow-list / Docker health |
| `DOCKER_HOST not configured` | No TCP Docker endpoint | Set `DOCKER_HOST=tcp://docker-socket-proxy:2375` |
| `no connector` | Abuse check has no Supabase source | Configure Settings → Connectors |
