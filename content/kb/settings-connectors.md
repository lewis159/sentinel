# Settings → Connectors

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Connectors** (route `/settings/connectors`) is where you wire Sentinel to the **external**
systems it monitors — chiefly the YT Transcriber **Supabase** database (platform users,
videos, transcripts). Credentials are stored **in Sentinel's database, not in environment
variables**, so you can add, test, enable/disable and rotate sources from the UI without a
redeploy.

![Settings → Connectors — configure and test a Supabase source](./images/settings-connectors.png)

## How to use it

- Open `/settings/connectors`, add or edit the **Supabase** connector: a **URL** and a
  **key**. Toggle **enabled**, then **test** the connection.
- Once enabled and configured, [User Audit](./users.md), Overview platform stats, and the
  `abuse` scan check all pull live data through it.
- Other settings surfaces: **Channels** (notifications), **Integrations** (scanners,
  webhook-in sources, Hermes AI), **Schedules**, **Roles** (`/settings/roles`).

## How it works (technical)

Connectors live in `public.connectors` (`id, name, type, config, enabled, status,
updated_at`). From `lib/connectors.ts`:

- `listConnectors()` — lists all configured sources.
- `getSupabase()` — builds a client from the first **enabled** `supabase` connector whose
  `config` has both `url` and `key`; returns `null` otherwise (callers then fall back to mock).
- `saveConnector()` — upserts one row per type; `status` becomes `configured` when a `url` is
  present, else `unconfigured`. Sessions are non-persistent (no token refresh/storage).

The connectivity badge (`dbStatus()`) does a head-count query against `users` to prove the
source works.

## Common tasks

- **Connect the platform DB:** add the Supabase connector → paste URL + key → enable → test.
- **Rotate a key:** edit the connector, replace the key, re-test — no redeploy needed.
- **Temporarily go offline:** disable the connector; pages fall back to mock with a note.

## Troubleshooting

- **"no connector" everywhere** — no enabled Supabase connector, or `config` is missing
  `url`/`key`. Both are required for `getSupabase()` to return a client.
- **Test fails with an error message** — the message is the raw Supabase error: wrong URL/key,
  RLS blocking the role, or a network issue. Verify the key has read access to `users`.
- **Status stuck at `unconfigured`** — the saved `config` has no `url`; re-enter it.

## Error codes / messages

| Message / note | Meaning | Fix |
|----------------|---------|-----|
| `no connector` | No enabled, fully-configured Supabase connector | Add URL + key and enable |
| `<supabase error>` (on test) | The live query failed | Fix URL/key/RLS/network and re-test |
| `unconfigured` (status) | `config.url` missing | Re-enter the connection URL |
| `no DB` | Sentinel's **own** Postgres is down (connectors table unreadable) | Fix the local DB first |
