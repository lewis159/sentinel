# Findings

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Findings** (route `/findings`) is the security-results ledger. Every issue the scan
engine detects — dependency advisories, leaked secrets, CVEs, missing headers, access/auth
gaps, abuse signals, capacity pressure — lands here as a finding with a stable reference
(`SEC-####`), a severity, an optional CVSS score, and a lifecycle status.

![Findings list — severity filter chips and source filter](./images/findings-filters.png)

## How to use it

- **List view** is severity-sorted (highest CVSS first). Filter by **status**, **source**
  (which check produced it), and **component**.
- **Detail view** (`/findings/[ref]`) shows the description, evidence, remediation guidance,
  the lifecycle, and a **Links panel** that walks the `ops.links` graph to related tickets,
  components, KB runbooks, scans and other findings.
- **Raise ticket** — from a finding, create a remediation ticket; Sentinel inserts the
  ticket and a `raises` link so the two stay connected.
- **Override status** — manually set a finding's status (e.g. mark a false positive). This
  sets `override_locked` so the next scan won't silently reopen it.

## How it works (technical)

| Field shown | Column in `ops.findings` |
|-------------|--------------------------|
| Ref | `ref` (e.g. `SEC-0009`) |
| Title / description | `title`, `description` |
| Severity | `severity` (critical/high/medium/low/info) |
| CVSS / CWE | `cvss`, `cwe` |
| Component | `component_label` |
| Source | `source` (the producing check) |
| Status | `status` (open / in_progress / fixed / …) |
| Age | derived from `last_seen_at` ?? `first_seen_at` |

Data access lives in `lib/data.ts`:
- `getFindings()` — `select … from ops.findings order by cvss desc nulls last`.
- `getOneFinding(ref)` — single finding by `ref`.
- `getFindingEdges(ref)` — reads `ops.links` in **both** directions (finding as source or
  target) to build the Links panel.
- `raiseTicketFromFinding(ref)` — inserts into `ops.tickets` and `ops.links` (`relation='raises'`).
- `updateFindingStatus(ref, status)` — updates `status` and sets `override_locked=true`.

The **worker** writes findings during scan runs; the app reads them. When the DB is
unreachable the page falls back to mock findings and drops the **live** badge.

## Common tasks

- **Triage the queue:** sort is already by CVSS; start at the top, filter status = `open`.
- **Remediate:** open the finding → *Raise ticket* → work the ticket → status flows back.
- **Dismiss a false positive:** override the status; it stays locked against re-detection.
- **See blast radius:** use the Links panel / [Graph](./graph.md) to see what a finding touches.

## Troubleshooting

- **A finding I fixed keeps reappearing** — if you didn't override-lock it, the scan reopens
  it each run while the underlying condition persists. Confirm the fix is deployed, then re-scan.
- **No tickets link back** — the `raises` link is only created via *Raise ticket*. Manually
  created tickets won't auto-link.
- **Empty list / demo data** — `ops.findings` is empty or the DB is down; see
  [Troubleshooting](./troubleshooting.md).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | App can't reach Sentinel Postgres | Check `DATABASE_URL` / DB container health |
| `empty` | Query returned 0 findings | Run a scan to populate |
| `finding SEC-#### not found` (Raise ticket) | Ref absent in `ops.findings` | Refresh; finding may be purged |
| `permission denied for schema ops` | App DB role lacks rights | Grant on schema `ops`; see [Error Codes](./error-codes.md) |
| `insert failed` (Raise ticket) | Ticket insert returned no row | Check `ops.tickets` constraints / sequence |
