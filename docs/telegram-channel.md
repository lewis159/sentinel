# Telegram channel (Hermes PA)

The first external messaging surface for the Hermes PA. An **allowlisted** user
DMs a Telegram bot; the message is routed into the Hermes Brain (PA persona) and
the Brain's reply is sent back. Everything is gated behind a runtime flag and the
bot is authenticated by a webhook secret — **you** activate it (create the bot,
set the webhook); the app only provides the plumbing.

## Architecture

```
Telegram → POST /api/hermes/channels/telegram → verify secret → allowlist
        → runPaTurn(persona 'pa') → sendMessage reply
```

- Adapter interface: `lib/hermes/channels/types.ts` (`ChannelAdapter`) — WhatsApp
  / Voice implement the same shape later.
- Telegram adapter: `lib/hermes/channels/telegram.ts`.
- Route: `app/api/hermes/channels/telegram/route.ts` (public route, secret-verified
  in-handler; registered in `middleware.ts`).
- Gated Brain actions stay gated: a tool the Brain wants is persisted as an action
  **proposal** (Sentinel Approvals queue) and the user is told "queued for
  approval" — nothing side-effecting runs from Telegram directly.

## Env / secrets

All secrets resolve **env first, then Infisical** (`getSecret`). None belong in
any client.

| Name | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot API token from @BotFather. Used only to send replies. **Server-only.** |
| `TELEGRAM_WEBHOOK_SECRET` | A random string you choose. Set it as the webhook `secret_token`; Telegram echoes it in `X-Telegram-Bot-Api-Secret-Token`, which the route verifies constant-time. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Comma-separated chat ids permitted to reach the Brain. **Empty ⇒ nobody is authorised (fail-closed).** |

Runtime flag (DB-override-then-env, like `HERMES_BRAIN_ENABLED`):

| Flag | Effect |
| --- | --- |
| `HERMES_TELEGRAM_ENABLED` | `1/true/yes/on` → webhook live. Off (default) → route returns 404. |
| `HERMES_BRAIN_ENABLED` | Must also be on for the Brain to actually answer; if off, the channel replies "assistant not enabled". |

## One-time activation (you run this)

1. Create a bot with **@BotFather** → copy the token → set `TELEGRAM_BOT_TOKEN`.
2. Pick a random `TELEGRAM_WEBHOOK_SECRET` (e.g. `openssl rand -hex 32`) and set it.
3. Find your chat id (message the bot, then `getUpdates`, or use @userinfobot) and
   put it in `TELEGRAM_ALLOWED_CHAT_IDS`.
4. Turn the flag on: `HERMES_TELEGRAM_ENABLED=1` (and `HERMES_BRAIN_ENABLED=1`).
5. Register the webhook (replace placeholders — **no real tokens in git**):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
        "url": "https://ops.bentech.dev/api/hermes/channels/telegram",
        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
        "allowed_updates": ["message"]
      }'
```

To stop it: `curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook"`
and/or set `HERMES_TELEGRAM_ENABLED=0`.

## Security notes

- Webhook secret compared **constant-time** (`crypto.timingSafeEqual`).
- Allowlist enforced server-side; un-allowlisted senders are **never** routed to
  the Brain (they get a polite refusal).
- Bot token never leaves the server.
- Non-message updates and text-less messages are ignored with a 200 (Telegram
  stops retrying).
- Brain errors reply generically and return 200 (no retry storm); logged
  server-side.
