# Incidents

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Incidents** (route `/incidents`) is incident mode — the place to coordinate response when
something significant breaks. An incident gathers the related findings, tickets and alerts
into one timeline and produces an auto-drafted post-mortem when it closes.

![Incident view — timeline with linked findings, tickets, alerts](./images/incident-timeline.png)

## How to use it

- **List** (`/incidents`) — open and closed incidents.
- **Incident view** (`/incidents/[id]`) — a chronological **timeline**, the linked
  findings/tickets/alerts, and an auto-generated post-mortem draft.
- Promote a serious alert (or cluster of findings) into an incident to declare it formally.

## How it works (technical)

- Incidents are an `ops` entity; their relationships to findings, tickets and alerts live in
  `ops.links`, which is why the timeline can assemble everything that touched the event.
- The timeline is built from the immutable activity stream plus comments (`ops.comments`),
  so it is an accurate, append-only record.
- The post-mortem is drafted from the timeline and linked entities (optionally enriched by
  the Hermes AI integration if configured in Settings → Integrations).

## Common tasks

- **Declare an incident:** promote from an alert or open a new incident, then link the
  contributing findings/tickets.
- **Run the response:** track work as tickets linked to the incident; comment to keep the
  timeline current.
- **Close out:** resolve the incident → review and edit the auto post-mortem → file it in the
  [Knowledge Base](./knowledge-base.md).

## Troubleshooting

- **Timeline missing events** — only linked entities and recorded activity appear; link the
  relevant findings/tickets/alerts.
- **No post-mortem draft** — drafting needs linked context; add links, or the Hermes
  integration may be unconfigured.
- **Empty list / demo data** — DB down or no incidents; see [Troubleshooting](./troubleshooting.md).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | Can't reach Postgres | Check DB / `DATABASE_URL` |
| `permission denied for schema ops` | DB role lacks rights | Grant on schema `ops` |
| `AI draft unavailable` | Hermes integration not reachable | Configure/verify Settings → Integrations |
