# Overview

_Living document — reflects the current build; re-verify after changes._

## Purpose

The **Overview** (route `/`) is Sentinel's posture dashboard — the first screen after
sign-in. It answers "is anything on fire right now?" at a glance: an overall health
score, open-finding KPIs broken down by severity, live platform stats, and a feed of
recent activity. It is the shared home for both the **Security** and **Operations**
workspaces.

![Overview dashboard — health score, severity bars, recent activity](./images/overview-dashboard.png)

## How to use it

- **Health score & severity bars** — read the top band first. Critical/high counts come
  from `ops.findings`; clicking a severity chip deep-links into [Findings](./findings.md)
  pre-filtered to that severity.
- **Platform stats** — users / videos / transcripts counts for the monitored platform,
  pulled live through the Supabase **connector**. A **live** badge means the numbers are
  real; without it they are representative fallbacks.
- **Run scan** — the top-bar action triggers the scan engine; see [Scans](./scans.md).
- **Recent activity** — a short slice of the immutable activity stream (full view at
  `/activity`).
- **Switch workspace** — the workspace switcher (🛡 Security / ◷ Operations) changes the
  sidebar groups. Landing on a workspace-owned route (e.g. `/infra`) auto-switches you.

### Traversal trail & ⌘K

Every page, including Overview, carries a **traversal trail** (your click path as a
breadcrumb) and the **⌘K command palette** for cross-entity jump-to-search.

## How it works (technical)

| Element | Data source |
|---------|-------------|
| Severity counts / health score | `ops.findings` via `getFindings()` (`lib/data.ts`) |
| Platform stats (users/videos/transcripts) | Supabase connector via `getPlatformStats()` |
| Connectivity badge | `dbStatus()` probe against the connector |
| Recent activity | `ops` activity/audit stream |

The health score is derived from open findings weighted by severity; CVSS feeds the
weighting where present (`ops.findings.cvss`). If the local DB is unreachable, the page
renders mock findings and drops the **live** badge.

## Common tasks

- **Jump to the worst problems:** click the Critical chip → filtered Findings list.
- **Kick off a scan:** top bar → *Run scan*.
- **Confirm you're seeing real data:** look for the **live** badge near the platform stats.

## Troubleshooting

- **No "live" badge / fallback numbers** — the Supabase connector is missing or disabled.
  Configure it in [Settings → Connectors](./settings-connectors.md).
- **Severity bars empty or look like demo data** — Sentinel's local Postgres is
  unreachable or the `ops.findings` table is empty; see [Troubleshooting](./troubleshooting.md).
- **Health score not changing after a fix** — findings update on the next scan run; trigger
  *Run scan* or wait for the schedule.

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no connector` (badge note) | No enabled Supabase connector | Add one in Settings → Connectors |
| `no DB` | `DATABASE_URL` not set for the app | Check the stack env; see [Build Process](./build-process.md) |
| `empty` | `ops.findings` returned 0 rows | Run a scan to populate findings |
