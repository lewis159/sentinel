# Sentinel auto-deploy & auto-migrator

Sentinel now deploys and migrates through the estate's GitHub-driven pipeline,
exactly like the yt-v2 apps in `lewis159/bentech-infra`. There are two independent
mechanisms:

1. **Auto-deploy the image** on every push to Sentinel `main`.
2. **Auto-migrator** for the DB schema — a tracked, dispatch-gated migration
   runner.

---

## 1. Auto-deploy flow (image)

Workflow: `.github/workflows/build-push.yml` (reworked).

```
push to sentinel main
  -> build & push ghcr.io/lewis159/sentinel:<sha>  (+ :latest)
  -> checkout lewis159/bentech-infra  (GITOPS_INFRA_TOKEN, fine-grained PAT)
  -> sed-bump the pinned image SHA in stacks/sentinel-ops-app.yml to <sha>
  -> commit + push to bentech-infra main
        └─ triggers bentech-infra/.github/workflows/deploy.yml
             (on: push touching stacks/**.yml)
           -> scripts/deploy-stack.sh reads stacks/manifest.json
              (sentinel-ops-app = stack id 23, endpoint 3)
           -> PUT /api/stacks/23  to the Portainer API (preserving .Env)
           -> Swarm rolling update of sentinel-ops-app_app
```

Key points:
- **No Portainer webhook.** The previous version POSTed a Portainer git-stack
  webhook. That is removed. Portainer Community Edition has no service webhooks,
  and the estate does not use them — every stack redeploys through
  `bentech-infra/deploy.yml`. The SHA bump is the entire trigger.
- **CI never holds a Portainer token.** `build-push.yml` holds only the scoped
  PAT (`GITOPS_INFRA_TOKEN`, contents:write on bentech-infra). The Portainer
  token lives in bentech-infra's own secrets and is used only by `deploy.yml`.
- **The SHA replace is anchored** on `image: ghcr.io/lewis159/sentinel:` + exactly
  40 hex chars, so it can only ever touch the one pinned image line.
- **No-op safe:** if the file already pins the current SHA, nothing is committed,
  no push happens, and `deploy.yml` does not fire.

### How it skips cleanly when unprovisioned
`GITOPS_INFRA_TOKEN` is mapped to a job-level env var `INFRA_TOKEN`. Both GitOps
steps are gated:

```yaml
if: ${{ (github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch') && env.INFRA_TOKEN != '' }}
```

So when the secret is unset the checkout + bump steps are **skipped (green)** — the
build still succeeds. (Secrets can't be used directly in `if:`, and a step-level
env isn't visible to that step's own `if:`, which is why the token is mapped at
job level.) The `feat/clerk-auth` branch build is likewise skipped-green because
it is not `main`.

---

## 2. Auto-migrator (DB schema)

Sentinel's schema is the ordered `db/init/*.sql` files (`01_…` … `22_…`). These
are applied by a migrator image, tracked so only pending files run.

### Files
- **`Dockerfile.migrator`** — `postgres:16-alpine`, `COPY db/init/ /migrations/`
  + `scripts/apply-migrations.sh`. Entrypoint exports `DATABASE_URL` from
  `/run/secrets/sentinel_migrator_db_uri`, then runs the apply script.
- **`scripts/apply-migrations.sh`** — the tracked apply logic:
  - `set -eu`, `psql … -v ON_ERROR_STOP=1`.
  - Ensures `ops` schema exists, then creates
    `ops.schema_migrations(filename text primary key, applied_at timestamptz)`
    if absent.
  - Iterates `db/init/*.sql` in filename (= numeric, zero-padded) order; **skips**
    any file already in `ops.schema_migrations`.
  - Applies each pending file with `psql --single-transaction -f <file>
    -c "INSERT INTO ops.schema_migrations(filename) VALUES('<file>')"` — the DDL
    and its tracking row commit atomically, so a failed migration rolls back and
    is **not** recorded. Idempotent: re-runs apply only genuinely new files.
  - `BASELINE=1` records all current files as applied without executing (for
    adopting a DB that already has the schema).
- **`scripts/run-sentinel-migrations.sh`** — runs the migrator image as a one-shot
  Swarm job on the host via the Portainer Docker API, on the `ytdb_ytdb` network,
  mounting the `sentinel_migrator_db_uri` secret; polls to completion, prints
  logs, cleans up, exits non-zero on failure. Adapted from
  `bentech-infra/scripts/run-migrations.sh`.
- **`.github/workflows/build-migrator.yml`** — builds + pushes
  `ghcr.io/lewis159/sentinel-migrator:latest` + `:<sha>` on push to main touching
  `db/init/**`, `scripts/apply-migrations.sh`, or `Dockerfile.migrator` (also
  `workflow_dispatch`). Does **not** apply anything.
- **`.github/workflows/run-migrations-prod.yml`** — `workflow_dispatch` **only**,
  requires typing `apply-prod` to confirm, then runs
  `scripts/run-sentinel-migrations.sh`. Fails loudly if the job state is not
  `complete`.

### Why the migrator runs on the box (not from CI)
The prod Postgres has no published ports — it is only reachable inside the
`ytdb_ytdb` Docker network. So the migrator runs as a one-shot Swarm job on the
host via the Portainer Docker API, exactly like the estate migrator.

### ⚠ CRITICAL: the migrator role needs ELEVATED DB privilege
Sentinel's migrations do DDL a plain app role cannot perform, e.g.:
- `create schema if not exists ops;` (`01_schema.sql`) — needs CREATE on the DB.
- `create extension if not exists vector;` (`13_hermes_kb.sql`) — **pgvector is
  NOT a trusted extension**, so this requires **superuser**.
- sequences, RLS enable/disable, triggers on ops-owned tables.

Therefore `sentinel_migrator_db_uri` **must** use a role with sufficient
privilege: the **`postgres` superuser**, OR a dedicated migrator role granted
ownership/superuser over the `ops` schema (and able to `CREATE EXTENSION`). This
is a **security-sensitive credential** — keep it as a Docker secret on the box,
never inline it in a stack file or a migration, and scope it to migrations only.

### ⚠ Ordering: migrate BEFORE deploying the new image
Run the migrator **before** the new Sentinel image is deployed (or the app
degrades until the schema catches up). Recommended sequence for a schema-changing
release:
1. Merge the migration + code to `main`.
2. `build-migrator.yml` builds the migrator image automatically.
3. Manually run **run-migrations-prod** (type `apply-prod`) and confirm it
   reports `SENTINEL MIGRATIONS OK`.
4. Then let / re-run `build-push.yml` so the new app image deploys onto the
   already-migrated schema. (`build-push.yml` runs on the same push, so for
   schema-breaking changes, gate the merge or roll the app after the migrator.)

---

## What Ben must provision

### GitHub secrets on `lewis159/sentinel`
| Secret | Purpose | Notes |
|---|---|---|
| `GITOPS_INFRA_TOKEN` | Push the image-SHA bump to bentech-infra | Fine-grained PAT, **contents:write on `lewis159/bentech-infra` only**. `gh secret set GITOPS_INFRA_TOKEN -R lewis159/sentinel` |
| `PORTAINER_URL` | Migrator trigger (Portainer Docker API base) | Same value bentech-infra uses |
| `PORTAINER_TOKEN` | Migrator trigger (Portainer API key) | Same value bentech-infra uses |

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is a repo **Actions variable** (already used).

### Docker secret on the box
| Secret | Value | Privilege |
|---|---|---|
| `sentinel_migrator_db_uri` | `postgresql://<role>:<pw>@<host>:5432/<sentinel-db>` | **Superuser or ops-schema owner** — see the CRITICAL note above. Reachable on `ytdb_ytdb`. |

### bentech-infra `manifest.json`
- **Deploy:** no change needed — `sentinel-ops-app` is already registered (id 23,
  endpoint 3), so the SHA bump auto-redeploys.
- **Migrator:** no manifest entry needed. Following the estate pattern, the
  migrator runs as an **ad-hoc one-shot Swarm job** created directly against the
  Portainer Docker API (`/services/create`), not as a registered Portainer stack.
  `manifest.json` is only for stacks driven by `deploy.yml`.
