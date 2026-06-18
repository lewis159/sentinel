# Sentinel Knowledge Base

_Living document — reflects the current build; re-verify after changes._

Welcome to the **Sentinel** Knowledge Base. Sentinel is an internal, single-pane
**Operations & Security Console**: one place to detect security findings, run scans,
audit users, manage tickets and incidents, watch infrastructure, and operate the
high-availability stack that runs your platform.

This KB is both the **in-app help system** (served at `/kb`) and the **source content
for a PDF export** (Reports → posture / evidence packs reuse these articles).

![Sentinel Overview — two workspaces, command palette](./images/overview-shell.png)

## How the Knowledge Base works

- **In-app:** every article lives in `ops.kb` and renders under `/kb/[slug]`. Articles
  can be **linked** to findings, tickets and components through the `ops.links` graph,
  so a runbook surfaces directly on the entity it explains.
- **Search:** use the **⌘K command palette** (Cmd/Ctrl+K) from anywhere to jump to an
  article, a finding (`SEC-####`), a ticket (`OPS-####`), a component, or a user.
- **Traversal trail:** as you click between linked entities, Sentinel records your path
  as a breadcrumb trail at the top of each page so you can walk back the way you came.
- **PDF export:** these markdown files are the canonical source. Reports → *Generate
  posture PDF* renders selected articles plus live evidence into a branded document.

## Sections

### Getting around
- [Overview](./overview.md) — the posture dashboard and the two-workspace shell.
- [Graph](./graph.md) — the visual explorer of the `ops.links` relationship graph.

### Security workspace
- [Findings](./findings.md) — security results, severity, lifecycle, links.
- [Tickets](./tickets.md) — work items and remediation tracking.
- [Scans & Checks](./scans.md) — the detection engine and run history.
- [User Audit](./users.md) — risk-scored anti-abuse review.
- [Alerts](./alerts.md) — rule-driven signal inbox.
- [Incidents](./incidents.md) — incident mode, timelines, post-mortems.

### Operations workspace
- [Infra / Monitoring](./infra.md) — live containers and capacity.
- [Components](./components.md) — service/component inventory.

### Reference
- [Knowledge Base & Runbooks](./knowledge-base.md) — authoring articles.
- [Reports & Compliance](./reports.md) — posture PDFs and evidence packs.
- [Settings → Connectors](./settings-connectors.md) — external data sources.

### Operating Sentinel itself
- [Architecture](./architecture.md) — system design, data flow, the `ops` schema.
- [Build Process](./build-process.md) — fast `C:\dev` builds, Docker image, local & HA stacks.
- [HA Runbook](./ha-runbook.md) — failover, node roles, growth, recovery.
- [Troubleshooting](./troubleshooting.md) — common issues across the app.
- [Error Codes](./error-codes.md) — error messages and their fixes.

## Conventions used in this KB

| Convention | Meaning |
|------------|---------|
| `SEC-####` | A security finding reference (`ops.findings.ref`) |
| `OPS-####` | A ticket reference (`ops.tickets.ref`) |
| `ops.*`    | A table in Sentinel's local Postgres `ops` schema |
| **live** badge | The data on screen came from a real database/socket, not mock fallback |
| **Connector** | An external data source configured in Settings, not via env vars |

> Every page in Sentinel falls back to representative mock data when its data source is
> unreachable, so the console always renders. A **live** badge tells you whether what you
> are looking at is real or fallback — see [Troubleshooting](./troubleshooting.md).
