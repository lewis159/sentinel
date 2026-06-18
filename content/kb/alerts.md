# Alerts & Rules

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Alerts** (route `/alerts`) is the signal inbox — the automation layer that turns
conditions (a critical finding appears, a container restarts repeatedly, capacity crosses a
threshold) into actionable, de-duplicated alerts. **Rules** define when an alert fires and
what happens next. Alerts appear in both workspaces under **Respond / Signals**.

![Alerts inbox — firing, acknowledged, resolved grouped by dedup key](./images/alerts-inbox.png)

## How to use it

- **Inbox** (`/alerts`) — alerts grouped by **dedup key** and bucketed into firing /
  acknowledged / resolved. Acknowledge or resolve from here.
- **Alert detail** (`/alerts/[id]`) — what fired, the rule behind it, and ack/resolve actions.
- **Rules list** (`/alerts/rules`) — every when-this-then-that rule.
- **Rule editor** (`/alerts/rules/[id]`) — a trigger + action JSON builder with **quiet hours**.

## How it works (technical)

- Rules are stored in `ops.rules`; firing alerts are rows in `ops.alerts`, keyed by a
  **dedup key** so a repeating condition collapses into one alert with a count rather than
  a flood.
- The **worker** evaluates rules against new findings, capacity snapshots and job results,
  and writes alerts. Rule **actions** dispatch notifications through the channels configured
  in Settings → Channels (email · Slack · Telegram · webhook); **quiet hours** suppress
  non-critical delivery during configured windows.
- Alerts can escalate into **incidents** and can spawn **tickets**; those relationships live
  in `ops.links`.

## Common tasks

- **Triage:** work the firing bucket; acknowledge what you're handling, resolve what's done.
- **Stop noise:** open the rule → tune the threshold or add quiet hours.
- **Wire a new automation:** Rules → new rule → set trigger + action JSON.

## Troubleshooting

- **Alerts fire but no notification arrives** — the rule's action channel isn't configured or
  quiet hours are active; check Settings → Channels and the rule's quiet-hours window.
- **Duplicate alerts** — the dedup key is too specific; broaden it in the rule.
- **No alerts ever fire** — the worker isn't evaluating rules; check the worker pool
  (see [Build Process](./build-process.md)).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | Can't reach Postgres | Check DB / `DATABASE_URL` |
| `channel test failed` | Notification channel unreachable | Re-check channel creds in Settings → Channels |
| `permission denied for schema ops` | DB role can't write `ops.alerts` | Grant on schema `ops` |
