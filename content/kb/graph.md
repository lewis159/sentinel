# Graph

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Graph** (route `/graph`) is Sentinel's signature view: a visual explorer of the
`ops.links` relationship graph — the "everything connects" picture. Findings, tickets,
components, scans and KB articles are nodes; the edges are the relationships between them.
It's how you see, in one canvas, the full blast radius of an issue.

![Graph — visual explorer of the ops.links relationship graph](./images/graph-explorer.png)

## How to use it

- Open `/graph` to see the whole relationship graph; pan and zoom to explore.
- Click a node to focus it and reveal its neighbours; click through to the entity's page.
- The per-page **Links panel** is a local slice of this same graph; Graph is the global view.

## How it works (technical)

- Every edge is a row in **`ops.links`**: `(src_type, src_id, relation, dst_type, dst_id)`.
- Node types and their routes (from `lib/data.ts` `hrefFor`): `ticket → /tickets/[id]`,
  `component → /components/[key]`, `kb → /kb/[slug]`, `finding → /findings/[ref]`,
  `scan → /scans/runs/[id]`.
- Edges are read **bidirectionally** — a finding's neighbours include links where the finding
  is the source *or* the target (see `getFindingEdges`).
- Relationships are created as you work: *Raise ticket* writes a `raises` edge; linking a KB
  article or component writes its edge; incidents tie alerts/findings/tickets together.

## Common tasks

- **Trace blast radius:** start from a critical finding, expand outward to see every affected
  component and open ticket.
- **Find orphans:** nodes with no edges are unlinked — likely missing context.
- **Navigate by relationship:** use Graph as a map, clicking through to detail pages.

## Troubleshooting

- **Graph looks sparse** — links are only created when you act (raise tickets, attach KB,
  declare incidents); back-fill missing edges from each entity.
- **A node won't open** — its `type` has no route mapping (`hrefFor` returns `#`); only the
  mapped types are navigable.
- **Empty graph** — `ops.links` empty or DB down; see [Troubleshooting](./troubleshooting.md).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | Can't reach Postgres | Check DB / `DATABASE_URL` |
| `permission denied for schema ops` | DB role can't read `ops.links` | Grant select on schema `ops` |
