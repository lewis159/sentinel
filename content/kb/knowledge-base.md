# Knowledge Base & Runbooks

_Living document — reflects the current build; re-verify after changes._

## Purpose

The **Knowledge Base** (route `/kb`) is Sentinel's library of articles and operational
**runbooks**. It is the same content you are reading now: how-to docs, remediation
procedures, and incident playbooks — each linkable to the findings, tickets and components
it explains, so guidance appears exactly where it's needed.

![Knowledge Base — browse and search articles and runbooks](./images/kb-browse.png)

## How to use it

- **Browse / search** (`/kb`) — find an article by title, tag, or full text. The **⌘K**
  palette also searches KB.
- **Article / runbook** (`/kb/[slug]`) — the rendered content plus a Links panel showing the
  findings/tickets/components it's attached to.
- **Author / edit** (`/kb/new`, `/kb/[slug]/edit`) — write in markdown; link the article to
  the entities it covers.

## How it works (technical)

- Articles are stored in `ops.kb` (slug, title, body markdown, tags, timestamps).
- Links to other entities are rows in `ops.links` (e.g. `kb → finding`, `kb → component`),
  so a runbook surfaces on the entity's detail page and vice-versa.
- The markdown source for the shipped KB lives in `content/kb/*.md` and is the canonical
  source for the **PDF export** (Reports renders these into branded documents).

## Common tasks

- **Write a runbook:** `/kb/new` → markdown → link it to the relevant finding/component.
- **Attach guidance to a finding:** link an existing article so it shows in the finding's
  Links panel.
- **Keep docs current:** every article carries a "Living document" note — update it after
  build changes and re-verify.

## Troubleshooting

- **Article doesn't show on a finding/component** — the `ops.links` edge is missing; add the
  link from either side.
- **Search misses an article** — confirm it's saved (not a draft) and re-index if your build
  uses a search index.
- **Markdown renders oddly** — check for unclosed code fences or tables.

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | Can't reach Postgres | Check DB / `DATABASE_URL` |
| `article not found` | Slug doesn't exist in `ops.kb` | Verify the slug / create the article |
| `permission denied for schema ops` | DB role can't write `ops.kb` | Grant on schema `ops` |
