# Sentinel Discord bot

A **second interface** onto the Sentinel ops console + Hermes AI agents. It is a
**thin client** — no DB, no ops logic, no Hermes brain of its own. Every action is
an HTTP call to Sentinel's token-gated `/api/bot/*` surface. Copilot-first: Hermes
**drafts**, a human clicks **Approve** in Discord. The bot never auto-sends a
customer reply and never moves money.

Design doc: [`../docs/discord-integration.md`](../docs/discord-integration.md).

## What it does

- **`/ticket`** — opens a Sentinel ticket; Hermes drafts a reply that comes back as
  an embed with **Approve & send / Edit / Dismiss** buttons.
- **Approval queue** — polls pending Hermes proposals and posts them to `#approvals`
  with Approve/Dismiss buttons.
- **Outbound events** — polls new/updated tickets and posts incidents to `#incidents`,
  everything else to `#tickets`.
- **Two-way updates** — replies in a ticket's thread become internal ticket comments.

## Prerequisites

- Node ≥ 20.
- A running Sentinel with `OPS_BOT_TOKEN` set (see the app's `.env.example`), and a
  live Postgres for the Hermes queue / comments to persist. `OPENROUTER_API_KEY` on
  Sentinel for real Hermes drafts.

## 1. Create the Discord app + bot token

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** → **Reset Token** → copy the token → this is `DISCORD_BOT_TOKEN`.
3. **Bot** → enable the **Message Content Intent** (needed to read thread replies).
4. **OAuth2** → copy the **Client ID** → `DISCORD_CLIENT_ID`.
5. **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`; bot
   permissions: *Send Messages, Create Public Threads, Send Messages in Threads,
   Embed Links, Read Message History*. Open the generated URL, invite to your server.
6. In Discord, enable **Developer Mode** (Settings → Advanced), then right-click your
   server → **Copy Server ID** (`DISCORD_GUILD_ID`) and each channel → **Copy Channel
   ID** for the four channel vars.

## 2. Configure

```bash
cp .env.example .env   # fill in the values
```

Secrets in prod live in **Infisical** (project `scribuo-prod`): store
`DISCORD_BOT_TOKEN` and `OPS_BOT_TOKEN` there and set the `INFISICAL_*` bootstrap
vars — the bot resolves them at boot (env still wins for local dev). `OPS_BOT_TOKEN`
**must match** the value Sentinel is running with.

## 3. Install, register commands, run

```bash
npm install
npm run register   # registers the /ticket guild command (instant)
npm run dev        # tsx watch (local)   — or —   npm run build && npm start
```

Docker:

```bash
docker build -t sentinel-discord-bot .
docker run --env-file .env sentinel-discord-bot
```

## Layout

```
src/
  config.ts        env + Infisical secret resolution
  sentinel.ts      typed HTTP client over /api/bot/*
  commands.ts      /ticket definition
  register.ts      one-shot guild command registration
  embeds.ts        proposal/ticket → embeds + button rows
  state.ts         in-memory thread↔ref map, dedupe sets, poll cursor
  handlers/
    ticket.ts      /ticket → create + triage + thread
    proposal.ts    Approve/Edit/Dismiss buttons + edit modal
    thread.ts      thread replies → ticket comments
  poller.ts        polls proposals + events → channels
  index.ts         bootstrap + wiring + login
```

## Testing without full credentials

- **No `DISCORD_BOT_TOKEN`** → `loadConfig()` throws at boot (fails fast). You can
  still `npm run build` / `typecheck` the code.
- **No running Sentinel** → point `SENTINEL_API_BASE` at a mock server; the client
  surfaces HTTP errors in Discord rather than crashing.
- **No Postgres on Sentinel** → the Hermes queue reads empty and comment writes
  404; the bot degrades gracefully (empty approvals, no events).

## Guardrails

- The bot exposes **no** money-movement action.
- A customer-facing draft only leaves Sentinel's buffer when a human clicks
  **Approve** (→ `POST /api/bot/proposals/:id`). Thread replies post **internal**
  updates only.
- All bot writes are attributed `discord:<username>` for audit in the web console.
