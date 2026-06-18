# Infra / Monitoring

_Living document — reflects the current build; re-verify after changes._

## Purpose

**Infra** (route `/infra`) is the Operations workspace home: a live view of every container
in the stack — state, restart counts, the node it runs on, and capacity. It is how you see,
at a glance, whether the platform's runtime is healthy.

![Infra — container list with live state and restarts](./images/infra-containers.png)

## How to use it

- **Container list** (`/infra`) — name, component, state, restarts, node. State and restart
  counts are **live** when the socket-proxy is reachable.
- **Container detail** (`/infra/[name]`) — stats history, capacity trend, lifecycle actions
  (start/stop/restart — **phrase-confirmed** to prevent accidents), and linked findings.
- Containers are grouped into **components** by name prefix (the part before the first `_`
  or `.`), e.g. `app_1` → component `app`. See [Components](./components.md).

## How it works (technical)

Live container data comes from the read-only **docker-socket-proxy** over the Docker Engine
API (`lib/docker.ts`):

- `hasDocker` is true only when `DOCKER_HOST` is set and starts with `tcp://`.
- `getContainers()` calls `GET /v1.44/containers/json?all=true` through the proxy and maps
  `Names`, `State`, `RestartCount`, and the swarm node label.
- **Important:** only the container **list** is live. Per-container CPU/memory come from the
  Engine `/stats` endpoint, which is **out of scope** in the current build — the detail
  page shows mock stats history. The list shows `cpu/mem = 0` rather than fabricated load.

The worker also periodically writes `ops.container_snapshots` (capacity history) so trends
survive restarts; the capacity check raises findings when a container sustains high memory.

Why a proxy: the app never gets the raw Docker socket (that itself is finding `SEC-0009`).
The proxy exposes a **read-only** allow-list, removing the container-escape risk.

## Common tasks

- **Spot a crash-looping container:** sort/scan by restart count.
- **Restart a service:** open the container → lifecycle action → type the confirmation phrase.
- **Trace an incident to a host:** the node column tells you which swarm node it's on.

## Troubleshooting

- **All containers show as mock / no live badge** — `DOCKER_HOST` unset or not `tcp://`, or
  the proxy is down. See [Troubleshooting](./troubleshooting.md).
- **CPU/Mem always 0** — expected; `/stats` is not wired up yet (see above).
- **Node shows `—`** — the container has no swarm node label (e.g. plain `docker run`).

## Error codes / messages

| Message | Meaning | Fix |
|---------|---------|-----|
| `DOCKER_HOST not configured` | No TCP endpoint | Set `DOCKER_HOST=tcp://docker-socket-proxy:2375` |
| `docker API timeout` | Proxy unresponsive within 4s | Check proxy container & network |
| `docker API 4xx for <path>` | Path not on proxy allow-list | Enable the needed read endpoint on the proxy |
| `docker API 5xx for <path>` | Docker daemon error | Check daemon health on the node |
