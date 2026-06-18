# Tickets

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Tickets** (route `/tickets`) is Sentinel's work-item tracker — the **Respond** half of
the Security workspace. A ticket (`OPS-####`) represents something a human needs to do:
remediate a finding, act on an alert, or a plain manual task. Tickets carry a type,
status, priority, source and (optionally) a link back to the finding that spawned them.

![Tickets queue — filter by type, status, priority](./images/tickets-queue.png)

## How to use it

- **Queue / board** — filter by **type** (security / infra / task), **status**
  (open / in_progress / blocked / resolved), **priority**, and assignee.
- **Detail** (`/tickets/[ref]`) — comments/activity timeline, SLA, the status machine, and
  a **Links panel** to the originating finding, components and KB runbooks.
- **New** (`/tickets/new`) — create a manual ticket.
- Tickets raised from a finding inherit the finding's priority (an `info` finding maps to
  `low`) and a `Remediate <finding title>` title.

## How it works (technical)

| Field shown | Column in `ops.tickets` |
|-------------|-------------------------|
| Ref | `ref` (e.g. `OPS-0007`) |
| Title | `title` |
| Type | `type` (security / infra / task) |
| Status | `status` |
| Priority | `priority` |
| Source | `source` (finding / alert / manual) |
| Age | derived from `opened_at` ?? `created_at` |

Data access (`lib/data.ts`):
- `getTickets()` — `select … from ops.tickets order by opened_at desc nulls last`.
- `getOneTicket(ref)` — single ticket.
- `raiseTicketFromFinding(ref)` — inserts the ticket plus a `finding → ticket` link with
  `relation='raises'` in `ops.links`.

Comments live in `ops.comments`; the activity/SLA timeline is assembled from comments plus
the immutable activity stream.

## Common tasks

- **Work the security queue:** filter type = security, status = open, sort by priority.
- **Track a remediation:** open the linked finding from the ticket's Links panel to confirm
  the underlying issue is resolved before closing.
- **Add context:** drop a comment on the ticket (stored in `ops.comments`).

## Troubleshooting

- **Ticket has no linked finding** — only tickets created via *Raise ticket* on a finding
  get a `raises` link; manual tickets do not.
- **Closing a ticket doesn't clear the finding** — finding status is independent; override
  or re-scan the finding so it reflects the fix.
- **Empty queue / demo data** — `ops.tickets` empty or DB down; see [Troubleshooting](./troubleshooting.md).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | App can't reach Postgres | Check DB container / `DATABASE_URL` |
| `empty` | 0 tickets returned | Create one or raise from a finding |
| `insert failed` | Ticket insert returned no row | Check `ops.tickets` sequence / constraints |
| `permission denied for schema ops` | DB role lacks write rights | Grant insert/update on `ops`; see [Error Codes](./error-codes.md) |
