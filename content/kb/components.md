# Components

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Components** (route `/components`) is the service/component inventory — the logical map of
your platform (app, api, nginx, db, worker, …). Where [Infra](./infra.md) shows individual
containers, Components rolls them up into the services they belong to and ties each service
to its findings, tickets and runbooks.

![Components inventory — services and their health](./images/components-inventory.png)

## How to use it

- **Inventory** (`/components`) — every component from `ops.components`, with its container
  count and health.
- **Component detail** (`/components/[key]`) — the containers that make it up, its open
  findings and tickets, and linked KB runbooks. This is the natural landing page when a
  finding names a component.

## How it works (technical)

- Components are stored in `ops.components` (key, label, metadata).
- Containers are associated to a component by name prefix at read time (the part before the
  first `_`/`.`; see `lib/docker.ts`), and via explicit links in `ops.links`.
- Findings reference a component through `ops.findings.component_label`; tickets and KB
  articles connect via `ops.links`, so a component page aggregates everything that touches it.

## Common tasks

- **Audit one service:** open the component → review its open findings and tickets together.
- **Find the runbook for a service:** the component's Links panel surfaces linked KB articles.
- **See the component behind a finding:** click the component label on any finding.

## Troubleshooting

- **A container isn't grouped under the expected component** — its name prefix doesn't match
  the component key; rename the container or add an explicit link in `ops.links`.
- **Component has no findings/tickets but you expect some** — links may be missing; check the
  `ops.links` graph or the [Graph](./graph.md) explorer.
- **Empty inventory** — `ops.components` is empty or DB down; see [Troubleshooting](./troubleshooting.md).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | App can't reach Postgres | Check DB / `DATABASE_URL` |
| `empty` | `ops.components` returned 0 rows | Seed components or run discovery |
| `permission denied for schema ops` | DB role lacks rights | Grant on schema `ops` |
