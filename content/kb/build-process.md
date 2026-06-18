# Build Process

_Living document — reflects the current build; re-verify after changes._

## Purpose

How Sentinel is built and run — from fast local development on the C: drive to the Docker
image, the local stack, and the production HA stack.

![Build process — local dev, Docker image, HA stack](./images/build-stack.png)

## Source layout

The working build lives on the **fast C: drive** at `C:\dev\sentinel\code`:

| Path | Contents |
|------|----------|
| `app/` | Next.js routes (every page in the sitemap) |
| `lib/` | db.ts, data.ts, connectors.ts, docker.ts, nav.ts, mock.ts |
| `content/kb/` | This Knowledge Base (markdown source for in-app KB + PDF export) |

> Build on the C: drive (local SSD) for speed. The Z: copy under `new project/sentinel` holds
> design docs (e.g. the sitemap) and is not the fast build path.

## Local development

- Standard Next.js dev server for hot-reload work against `app/` and `lib/`.
- With **no** DATABASE_URL / DOCKER_HOST / connector, every page renders from `lib/mock.ts`
  so the full flow is navigable without any backend.
- The Postgres pool is cached on `global._sentinelPool` so hot-reloads do not leak connections
  (`lib/db.ts`).

### Key environment / config

| Variable / config | Purpose |
|-------------------|---------|
| `DATABASE_URL` | Sentinel's own Postgres (sets `hasDb`) |
| `DOCKER_HOST` | tcp://docker-socket-proxy:2375 for live container data (sets `hasDocker`) |
| Clerk keys | Invite-only auth |
| **Connectors** (in DB, not env) | External Supabase source — set in Settings → Connectors |

## Docker image & the local stack

Sentinel ships as a container image. The **local stack** brings up:

1. **app** — the Next.js container, with DATABASE_URL and DOCKER_HOST set by the stack.
2. **sentinel-db** — local Postgres owning the `ops` schema + `public.connectors`.
3. **worker** — runs scans, writes snapshots/findings, evaluates rules.
4. **docker-socket-proxy** — read-only Docker Engine API the app/worker read through.

Scope note: Sentinel only manages its **own** containers. Never touch pre-existing, unrelated
containers (scrobbler, akaunting, n8n2, etc.).

## HA stack (production)

For production the stack scales out:

- **Database:** Patroni (Spilo) + etcd + HAProxy for automatic primary/replica failover.
- **App:** multiple replicas behind a load balancer.
- **Worker:** a job-queue pool (multiple consumers off `ops.jobs`).
- **socket-proxy:** a global read-only proxy.

Topology: **2-node launch -> 3-manager growth**; the **3rd node** is the management plane
(Portainer + Sentinel). Production runs at `yt.bentech.dev` on Portainer; local Docker is for
dev builds. Operating procedures are in the [HA Runbook](./ha-runbook.md).

## Common tasks

- **Run with mock data only:** start the app with no DB/Docker/connector set.
- **Run against real data locally:** bring up the local stack (db + proxy + worker), then add
  the Supabase connector in Settings.
- **Promote a build:** build the image -> deploy to the Portainer/HA stack.

## Troubleshooting

- **Pages show demo data despite a DB** — DATABASE_URL not reaching the app, or the `ops`
  schema is not migrated/seeded. See [Troubleshooting](./troubleshooting.md).
- **No live containers** — DOCKER_HOST unset/not tcp://, or the proxy is not up.
- **Slow builds** — ensure you are building on the C: drive, not the Z: design copy.
- **Connection leaks in dev** — confirm the cached pool in `lib/db.ts` is in use.

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `no DB` | DATABASE_URL unset | Set it in the stack/env |
| `DOCKER_HOST not configured` | No TCP Docker endpoint | Point at the socket-proxy |
| `permission denied for schema ops` | DB role lacks rights post-migration | Grant on schema `ops` |
| Build OOM / slow | Building off the slow drive | Build on the C: drive |
