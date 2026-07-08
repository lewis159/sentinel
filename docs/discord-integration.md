# Sentinel × Discord — integration design

**Status:** design / draft
**Author:** ops
**Scope:** a Discord bot as a *second interface* onto the existing Sentinel ops console + Hermes AI agents.

---

## 1. Principle: one backend, two faces

```
                    ┌───────────────────────────┐
                    │   Sentinel backend         │
                    │   Next.js 15 · Postgres    │
                    │   ops.* · Hermes brain     │
                    └────────────┬──────────────┘
                        Clerk    │    token/HMAC
                    (web session)│   (machine callers)
              ┌─────────────────┐│┌────────────────────┐
              │  Web console     ││ │  Discord bot        │
              │  ops.scribuo.com ││ │  discord-bot/ (Node)│
              │  humans + Clerk  ││ │  discord.js v14     │
              └─────────────────┘  └────────────────────┘
```

The Discord bot is a **thin client** over Sentinel's HTTP APIs. It holds **no ops
data, no DB, no Hermes logic** of its own. Every ticket, comment, proposal and
Hermes call is an HTTP round-trip to Sentinel. The bot's only job is to translate
between Discord interactions (slash commands, buttons, threads) and Sentinel's API,
and to render Sentinel state as Discord embeds.

The backend is **not forked**. We add one new *token-gated API surface* (`/api/bot/*`)
that mirrors the existing ingest-auth pattern, so the bot can act without a Clerk
session — exactly as estate apps and CI already do via `/api/ingest/*`.

---

## 2. Auth model

Sentinel already has two non-Clerk ingest tiers (`OPS_REPORT_TOKEN`,
`OPS_INGEST_SECRET`) verified in-route by [`lib/ingest-auth.ts`](../lib/ingest-auth.ts)
(token via `x-ingest-token`/`Bearer`, or HMAC via `x-ingest-signature`, all
constant-time). We add a **third, parallel tier** for the bot:

| Tier | Secret | Presented as | Grants |
|------|--------|--------------|--------|
| report | `OPS_REPORT_TOKEN` | token/HMAC | create a report ticket (browser widget) |
| privileged | `OPS_INGEST_SECRET` | token/HMAC | all `/api/ingest/*` |
| **bot (new)** | **`OPS_BOT_TOKEN`** | token/HMAC | the `/api/bot/*` surface below |

Rationale for a **dedicated `OPS_BOT_TOKEN`** rather than reusing `OPS_INGEST_SECRET`:
blast radius. If the bot host is compromised, rotating `OPS_BOT_TOKEN` disables the
bot without touching estate-app / CI ingest. The token lives in Infisical
(`scribuo-prod`), never plaintext.

**Web routes are untouched.** Clerk stays the only auth on `/api/tickets/*`,
`/api/hermes/*`, and every page. `/api/bot/*` is a *parallel* surface added to the
middleware public matcher and verified in-route by a new `verifyBotIngest()`.

**Audit.** Every bot-initiated write records its actor as `discord:<username>` (for
comments) or `by='discord:<username>'` (for proposal actions), so the web console's
timeline distinguishes bot-origin actions from operator actions.

---

## 3. Backend changes (Sentinel side)

### 3.1 `lib/ingest-auth.ts` — add a bot tier

```ts
export function verifyBotIngest(req, raw) {
  return verifyIngest(req, raw, [process.env.OPS_BOT_TOKEN]);
}
```

Same shape as `verifyPrivilegedIngest`; accepts only `OPS_BOT_TOKEN` (token or HMAC).

### 3.2 New routes under `/api/bot/*` (all token-gated, added to middleware public matcher)

| Method + path | Body / query | Maps to | Notes |
|---|---|---|---|
| `POST /api/bot/tickets` | `{kind,title,description?,app?,priority?,...}` | `createTicket()` | same validation as `/api/tickets`; also fires `autoTriage` |
| `POST /api/bot/tickets/[ref]/comments` | `{body, author?, kind?}` | `addTicketComment()` | customer-facing sends still go via Hermes-approve, not here |
| `GET  /api/bot/proposals` | `?status=pending&limit=` | `listProposals()` | approval-queue feed for the bot |
| `POST /api/bot/proposals/[id]` | `{action, by?}` | `actOnProposal()` | approve/dismiss/mark-sent; `by='discord:<user>'` |
| `POST /api/bot/triage` | `{ref, agent?}` | Hermes agents | run a department agent → `HermesProposal` (+ persisted id) |
| `GET  /api/bot/events` | `?since=<ISO cursor>` | tickets query | outbound feed: tickets created/updated since cursor |

`POST /api/bot/tickets/[ref]/comments` is functionally the existing
`/api/ingest/update`; we still add the explicit `/api/bot/*` route so the bot has one
coherent, single-token surface (and so `author` defaults to the Discord user, not
`'Claude'`). Internally it calls the same `addTicketComment()`.

Each route reads the **raw body once** (for HMAC), calls `verifyBotIngest`, then
delegates to the same `lib/data.ts` / `lib/hermes/*` functions the web routes use.
No business logic is duplicated.

### 3.3 Guardrails preserved

- The bot **cannot** auto-send a customer-facing reply. Hermes still only *drafts*;
  a human presses **Approve** in Discord, which calls `POST /api/bot/proposals/[id]`
  `{action:'approve'}` → `actOnProposal` posts the draft. Identical to the web model.
- The bot **cannot** move money. No billing/refund action endpoint is exposed;
  billing is copilot-only (`assessBilling` drafts, human approves).
- All writes are attributed (`discord:<user>`) and land in `ops.comments` /
  `ops.hermes_proposals.decided_by` for audit.

---

## 4. Bot service shape

```
discord-bot/
  package.json          # discord.js v14, undici; type: module
  Dockerfile            # node:20-alpine, non-root
  README.md             # create app, token, env, run
  .env.example
  src/
    config.ts           # env + Infisical resolve (mirror lib/secrets.ts REST)
    sentinel.ts         # typed HTTP client over /api/bot/* (token header)
    commands.ts         # slash-command definitions + register script
    embeds.ts           # HermesProposal/ticket → Discord embeds + button rows
    handlers/
      ticket.ts         # /ticket → POST /api/bot/tickets → triage embed
      proposal.ts       # button interactions: approve / dismiss / edit
      thread.ts         # thread replies → POST comment
    poller.ts           # poll /api/bot/proposals + /api/bot/events → channels
    index.ts            # client bootstrap, wiring, login
```

**Config (env + Infisical):** `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`,
`DISCORD_GUILD_ID`, channel ids (`DISCORD_SUPPORT_CHANNEL_ID`,
`DISCORD_INCIDENTS_CHANNEL_ID`, `DISCORD_APPROVALS_CHANNEL_ID`),
`SENTINEL_API_BASE` (e.g. `https://ops.scribuo.com`), `OPS_BOT_TOKEN`. Secrets
(`DISCORD_BOT_TOKEN`, `OPS_BOT_TOKEN`) resolve from Infisical when
`INFISICAL_*` bootstrap vars are present, else fall back to env (dev).

---

## 5. Channel / config mapping

| Sentinel concept | Discord surface |
|---|---|
| support inbox | `#support` channel — `/ticket` + monitored messages |
| Hermes approval queue | `#hermes-approvals` — pending proposals as embeds w/ buttons |
| new incidents / critical findings / SLA breaches | `#incidents` — outbound posts |
| one ticket's conversation | a **thread** under the originating message, named `INC-0001 · title` |

Mapping is env-driven (channel ids), so no code change to re-point channels.

---

## 6. Interaction flows

### 6.1 Inbound — `/ticket`
1. User runs `/ticket kind:incident title:"…" description:"…"` (or posts in `#support`).
2. Bot → `POST /api/bot/tickets` → `{ref}`.
3. If `HERMES_AUTO_TRIAGE=true`, Sentinel auto-drafts on create. Bot then
   `GET /api/bot/proposals?status=pending` (or the create response surfaces the id)
   and renders the draft as an **embed** (classification, priority, confidence,
   draft preview) with buttons **[Approve & send] [Edit] [Dismiss]**.
4. A thread is opened on the reply for the ticket's ongoing conversation.

### 6.2 Approval queue in chat
- `poller.ts` polls `GET /api/bot/proposals?status=pending` every N seconds.
- New proposals → embed in `#hermes-approvals` with **[Approve] [Dismiss]** buttons.
- Button custom-id encodes `proposal:<action>:<id>`; handler → `POST /api/bot/proposals/[id]`.
- **Edit** opens a Discord modal; on submit the edited text is posted as the reply
  (via comment endpoint) and the proposal marked `mark-sent`. *(v2 — skeleton stubs it.)*

### 6.3 Outbound events — **polling (chosen)**
- `poller.ts` polls `GET /api/bot/events?since=<cursor>` on an interval; new
  incidents / critical findings / SLA-breach tickets → posted to `#incidents`.
- Cursor (last-seen `created_at`/`updated_at`) is held in memory (v1) — a restart
  re-reads a short lookback window; dedupe by ref+event to avoid re-posting.

**Trade-off — poll vs webhook:**
- *Polling* (chosen): bot pulls. Sentinel needs **zero knowledge** of the bot (no
  outbound URL, no retry/queue, no signing egress). Robust to bot downtime (catches
  up on restart). Cost: latency = poll interval (seconds), and steady request load.
- *Webhook*: Sentinel pushes to a bot HTTP endpoint on events. Lower latency, but
  Sentinel must store the bot URL, sign+retry deliveries, and handle bot downtime
  (dead-letter). More moving parts on the backend for marginal latency gain.

Polling wins for v1: simpler, robust, and keeps the bot a pure client. A webhook can
be added later behind the same `/api/bot` token if sub-second latency is needed.

### 6.4 Two-way ticket updates
- A reply in a ticket's thread → bot maps thread → `ref` (thread name / stored map)
  → `POST /api/bot/tickets/[ref]/comments` `{body, author:'discord:<user>', kind:'update'}`.
- Customer-facing replies are **never** auto-sent this way — they always go through a
  Hermes proposal + human Approve.

---

## 7. What needs real credentials to fully test

- A real **`DISCORD_BOT_TOKEN`** + app (Developer Portal) and a guild the bot has
  joined, to log in, register commands, and exercise buttons.
- A running **Sentinel** with `OPS_BOT_TOKEN` set and a live Postgres (Hermes
  proposals + comments are no-ops without a DB). Without these the bot runs against
  a mock/stub Sentinel base and the button handlers log the intended HTTP call.
- `OPENROUTER_API_KEY` on Sentinel for real Hermes drafts (else `configured:false`).

---

## 8. Non-goals (v1)

- No slash-command auto-send of customer replies (copilot-first, always).
- No money movement / refunds from Discord.
- No bot-side persistence beyond an in-memory poll cursor + thread↔ref map.
- No per-Discord-user → Clerk-identity mapping (bot acts as one machine identity;
  actor recorded as `discord:<username>` for audit).
```
