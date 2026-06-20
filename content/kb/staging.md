# Staging Environment

_Living document — reflects the current build; re-verify after changes._

## Purpose

How to test a new feature on a real, isolated environment **before it goes live** — without a second host. There is one reusable **staging slot** at **`staging.bentech.dev`**; you "load" whichever app/feature-branch you're testing into it. First app wired: **YT Transcriber**. Companion to [Build Process](./build-process.md) and [HA Runbook](./ha-runbook.md). Full artifacts + scripts live in `documents/staging/` (STAGING_SETUP.md, staging_bootstrap.sh, yt_staging_clone.sql, yt-staging.stack.yml, NPM_STAGING_STEPS.md, ROLLOUT.md).

## The multi-use slot model

- **One subdomain** `staging.bentech.dev` (Cloudflare → host IP) → **one NPM proxy host** → one staging app service.
- **One app under test at a time** — keeps the footprint light on the single shared host. To test a different app, tear down the current staging stack and deploy that app's staging stack onto the same subdomain (only the NPM upstream changes).

## Architecture (YT)

```
Cloudflare staging.bentech.dev → NPM proxy host
   /          → yt-staging_app:3000
   /rest/v1/  → yt-staging_postgrest:3000   (rewrite /rest/v1 → /)
yt-staging_app  → PostgREST (above) for data; Clerk DEV (pk_test); Redis (prod, DB index 3)
yt-staging_postgrest → db = yt_staging (clone of prod, PII anonymized) in the same Patroni cluster
```

- **Data isolation:** a separate **`yt_staging`** database in the same Postgres cluster, fronted by its **own PostgREST** (own JWT secret). Redis is shared but isolated by **logical DB index 3** (prod = 0). MinIO not used by YT yet.
- **Auth:** the Clerk **Development instance** (`pk_test`/`sk_test`) for all staging — separate user pool from prod.

## Deploy a feature to staging

1. **Clerk (once):** add `https://staging.bentech.dev` as an allowed origin on the Clerk Dev instance.
2. **Secrets (once, host/PuTTY):** run `staging_bootstrap.sh` with `CLERK_SK_TEST` set — it generates the staging `PGRST_JWT_SECRET`, mints the anon + service JWTs, reads the prod authenticator password, and creates the staging Docker secrets on-host (`staging_pgrst_jwt_secret`, `staging_pgrst_db_uri`, `staging_supabase_service_role_key`, `staging_clerk_secret_key`; reuses `redis_password`). It prints the **public anon JWT**.
3. **Clone the DB (host/PuTTY):** run `yt_staging_clone.sql` on the Patroni leader — creates `yt_staging` as an **anonymized** clone of prod (emails, names, clerk ids, stripe ids, free-text notes scrubbed; tokens regenerated; logs not copied).
4. **Build the staging image:** trigger the `build-staging.yml` workflow with `clerk_publishable_key=<pk_test>` + `supabase_anon_key=<anon JWT from step 2>` → pushes `ghcr.io/lewis159/youtube-transcriber:staging-<sha>`.
5. **Deploy the stack:** deploy `yt-staging.stack.yml` via Portainer with that image (app + staging PostgREST), then **restart the NPM container** so it resolves the new services.
6. **NPM (UI):** add the `staging.bentech.dev` proxy host + the `/rest/v1` custom location + Let's Encrypt cert + Force SSL (see `NPM_STAGING_STEPS.md`).
7. **Verify:** `/api/health` (DB connected), sign in with a Clerk **test** user, `/rest/v1/` returns the PostgREST OpenAPI root.

## Promote staging → prod

⚠️ **Not a same-image promote.** `NEXT_PUBLIC_*` (Clerk publishable key, Supabase URL/anon key) are **baked at build time**, so staging and prod are different builds of the **same commit**. To promote: rebuild the same commit with the **prod** build-args (`pk_live` + prod URL/anon) via the normal prod build, then `docker service update --image …:<sha>` on the prod service. Rehearse any DB migration on `yt_staging` first.

## Key rules / gotchas

- **Staging `PGRST_JWT_SECRET` must differ from prod** — a leaked staging key must never read prod.
- **`staging_bootstrap.sh` re-run** with `FORCE_RECREATE=1` mints a **new** JWT secret → the previously-built staging image's baked anon key stops matching → **rebuild staging** after any such re-run.
- **Secrets stay on-host** — bootstrap + clone run in PuTTY; only the public anon JWT (+ pk_test) ever leave the host.
- **NPM `/rest/v1` rewrite must match prod's** (strip `/rest/v1`, forward `/`).
- **Whisper:** staging runs caption-scrape-only by default (no worker); only add a `yt-staging_whisper-worker` when the feature under test *is* the Whisper pipeline.
- **Load tests:** point a throwaway `yt-staging_redis` at the app before running k6, so a staging load test can't pressure prod Redis.

## Tear down / load a different app

`docker stack rm yt-staging` removes the slot's services (the `yt_staging` DB + secrets persist; drop them explicitly if rotating). Then deploy a different app's staging stack and repoint the NPM upstream.
