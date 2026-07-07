# Estate Security & Technical Review — 2026-07-07

> Whole-estate audit by nine parallel review agents — security · legacy debt · architecture. Report-only (no changes made during the review). Findings are also loaded as live records in [Findings](/findings) as **SEC-0010 … SEC-0057**; the remediation + product backlog is in the scribuo admin roadmap across 7 sprints.

| Critical | High | Medium | Low | Total |
|---|---|---|---|---|
| 4 | 16 | 21 | 7 | 48 |

## Executive summary

The application code is well-built — strong SSRF guard on outbound webhooks, clean multi-tenant isolation (every by-id query is user-scoped), no committed secrets, solid worker idempotency and Stripe signature/idempotency handling. The material risk is concentrated in **operations**: no backups anywhere, secrets sitting in plaintext on disk, an over-privileged Docker socket in internet-facing containers, and a deploy pipeline that does not gate on tests.

### The four to action first

1. **No backups — anywhere.** Host/volume loss = total, unrecoverable loss of scribuo production. pgBackRest is written but never deployed.
2. **Portainer admin token in plaintext on disk** — reads every Docker secret in the estate. Rotate + move off disk.
3. **Live Stripe + Clerk secret keys frozen in a capture dump** (`_cap_yt_services.json`). Rotate all four + delete.
4. **Raw Docker socket in internet-facing containers** — read-only bind ≠ read-only API = host root.

## Critical findings

### SEC-0010 — No automated backups for any datastore (estate-wide)

**Severity:** CRITICAL  ·  **Component:** `infra-postgres`  ·  **CWE:** CWE-1188  ·  **Location:** `deploy/prod/db.yml + all stacks`

Zero deployed backup for any Postgres/Redis/MinIO across the estate. OVH host/volume loss = total, unrecoverable loss of scribuo prod (users, transcripts, billing ledger, audio). RPO=since inception. pgBackRest is fully written in youtube-transcriber/db/pgbackrest but never wired into a stack. FIX: deploy pgBackRest sidecar on yt-v2-prod-db → OVH S3 (WAL+daily base) AND a stop-gap cron pg_dump + mc mirror; enable MinIO versioning; run a TEST RESTORE.

### SEC-0011 — Portainer admin API token in plaintext on disk

**Severity:** CRITICAL  ·  **Component:** `secrets-disk`  ·  **CWE:** CWE-312  ·  **Location:** `C:\dev\portainer.env`

Estate-wide Portainer admin token in cleartext on the workstation. It can read EVERY Docker secret (Stripe/Clerk/MinIO/DB/Anthropic) + deploy/exec any container. One file = whole estate. FIX: revoke+reissue token, scope it, keep out of C:\dev; treat as compromised.

### SEC-0012 — Live Stripe + Clerk secret keys frozen in captured dump

**Severity:** CRITICAL  ·  **Component:** `secrets-disk`  ·  **CWE:** CWE-312  ·  **Location:** `C:\dev\_cap_yt_services.json`

Stale `docker service inspect` dump contains live STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET. Financial fraud + user impersonation + forged webhooks if leaked. Running config is clean (now via /run/secrets). FIX: rotate all four, delete the dump; never retain a service-inspect capture.

### SEC-0013 — Raw Docker socket mounted into internet-facing containers

**Severity:** CRITICAL  ·  **Component:** `infra-swarm`  ·  **CWE:** CWE-250  ·  **Location:** `yt-transcriber_app, yt-monitoring_promtail (/var/run/docker.sock)`

yt-transcriber_app (processes untrusted YouTube URLs) and promtail bind-mount the raw docker.sock. Read-only BIND does not make the Docker API read-only → container escape = root on host = full estate. A scoped read-only socket-proxy (POST=0) exists but these bypass it. FIX: point both at the socket-proxy over the network; yt-transcriber_app should not touch the socket at all.

## High findings

### SEC-0014 — Clerk prod webhook uses a placeholder signing secret

**Severity:** HIGH  ·  **Component:** `clerk`  ·  **CWE:** CWE-347  ·  **Location:** `apps/web/app/api/webhooks/clerk/route.ts`

Prod scribuo_clerk_webhook_secret is a placeholder. If guessable → forge events: user.deleted removes arbitrary accounts, org membership events drive Stripe seat billing. Fail-closed means legit Clerk webhooks are currently REJECTED (400): user.deleted not honored (GDPR erasure gap + orphaned rows), org seat→Stripe sync broken, welcome emails dropped. Sign-in still works via JIT provisioning. FIX: set the real Clerk signing secret as a Docker secret + re-point the Clerk dashboard endpoint.

### SEC-0015 — Anonymous rate-limit key is client-spoofable (XFF)

**Severity:** HIGH  ·  **Component:** `scribuo-web`  ·  **CWE:** CWE-290  ·  **Location:** `apps/web/app/api/_lib/anon.ts:53-62`

getClientIp takes the FIRST X-Forwarded-For entry, which is attacker-controlled (NPM appends the real IP last). Sending a random XFF per request defeats the per-IP/day cap. Each accepted request enqueues a real job on the concurrency-1 worker shared with paying users → quota bypass + cost + starves paid transcriptions. Turnstile is skipped entirely when TURNSTILE_SECRET_KEY unset. FIX: derive client IP from the rightmost untrusted hop / X-Real-IP; make Turnstile mandatory in prod; give anon jobs a separate low-priority queue.

### SEC-0016 — Inline plaintext prod secrets in stack environment blocks

**Severity:** HIGH  ·  **Component:** `infra-swarm`  ·  **CWE:** CWE-312  ·  **Location:** `stacks yt-v2-prod-web(41), worker(45), api(44), hermes(8)`

MinIO ROOT S3_SECRET_KEY (+S3_ACCESS_KEY=scribuo-prod-root) and a shared WEBHOOK_EMIT_TOKEN are inline cleartext across 3 prod stacks; WEBUI_SECRET_KEY inline on hermes. Anyone with Portainer read / a stack export gets prod object-storage root. (Some introduced during the 2026-07-07 prod bring-up.) FIX: move to Docker secrets, create a scoped non-root MinIO user for app/worker, rotate the exposed key + token.

### SEC-0017 — Cloudflare API token in plaintext on disk

**Severity:** HIGH  ·  **Component:** `secrets-disk`  ·  **CWE:** CWE-312  ·  **Location:** `C:\dev\cloudflare.env`

CF API token + zone id in cleartext; implies DNS-edit scope. Blast radius: DNS takeover, issue LE certs for your domains (MITM proxied apps), hijack email routing. FIX: rotate, scope to one zone/DNS-edit, IP-allowlist, keep off disk.

### SEC-0018 — NPM admin password in plaintext on disk

**Severity:** HIGH  ·  **Component:** `secrets-disk`  ·  **CWE:** CWE-312  ·  **Location:** `C:\dev\npm.env`

Nginx Proxy Manager admin login in cleartext. NPM is the estate edge proxy → admin access re-routes any hostname to an attacker origin + replaces TLS = MITM every app. FIX: rotate, enable NPM 2FA, restrict admin UI to LAN/VPN.

### SEC-0019 — Admin/infra UIs exposed Cloudflare DNS-only (origin, no WAF)

**Severity:** HIGH  ·  **Component:** `dns-cloudflare`  ·  **CWE:** CWE-284  ·  **Location:** `grafana/minio/db/secrets/ops/hermes/board .bentech.dev`

15+ bentech.dev A-records are grey-cloud (DNS-only) publishing origin 51.83.7.159 directly, incl. Infisical (secrets), MinIO console, PostgREST (db), Grafana, Sentinel — bypassing Cloudflare WAF/DDoS. FIX: put admin/infra hosts behind CF proxy + Cloudflare Access / IP allowlist; prioritise Infisical, MinIO, Portainer, PostgREST.

### SEC-0020 — NPM admin UI published on host 0.0.0.0:81

**Severity:** HIGH  ·  **Component:** `infra-swarm`  ·  **CWE:** CWE-284  ·  **Location:** `nginx-proxy-manager-sqlite :81`

NPM admin panel binds 0.0.0.0:81 on the origin IP, bypassing Cloudflare; SSL:0/forceSSL:false. Whoever reaches :81 reconfigures all routing. FIX: bind admin to localhost/internal; front with authenticated CF-proxied host + cert.

### SEC-0021 — Portainer/PostgREST/OpenWebUI bound to host 0.0.0.0

**Severity:** HIGH  ·  **Component:** `infra-swarm`  ·  **CWE:** CWE-284  ·  **Location:** `portainer :9443/:8000, ytdb_postgrest :3001, open-webui :3000`

Data/admin planes bind all interfaces on the origin IP, reachable by IP:port bypassing NPM+Cloudflare (firewall-dependent). PostgREST is a direct DB REST API on the internet. FIX: restrict binds to internal; front via CF proxy + Access.

### SEC-0022 — _spring public app runs all queries as Supabase service_role

**Severity:** HIGH  ·  **Component:** `side-spring`  ·  **CWE:** CWE-269  ·  **Location:** `C:\dev\_spring\db.py:4-8, app.py:43-105`

Unauthenticated internet-facing Flask app queries Postgres with the RLS-bypassing service_role. Any injection/logic bug = full read/write over the whole Supabase project. FIX: use anon key + RLS for public paths; reserve service_role for the admin blueprint only.

### SEC-0023 — ofdl-manager portal binds 0.0.0.0 despite LAN-only intent

**Severity:** HIGH  ·  **Component:** `side-ofdl`  ·  **CWE:** CWE-668  ·  **Location:** `C:\dev\ofdl-manager\src\server.js:861`

Portal (streams downloaded media, triggers runs) listens on 0.0.0.0:8787 over plain HTTP; internet-reachable if the host has a public iface / port-forward. Session HMAC secret + password hash also sit in plaintext config.json (forgeable session). FIX: bind 127.0.0.1/LAN, firewall 8787, add TLS + Secure cookie; move secrets out of config.json.

### SEC-0024 — Credits debited but never refunded on failed transcription

**Severity:** HIGH  ·  **Component:** `scribuo-billing`  ·  **CWE:** CWE-840  ·  **Location:** `packages/db/.../transcription.ts claimTranscriptionSlot + workers/whisper/worker.py`

1 credit is debited at claim/queue time; on worker failure the video is marked error with NO refund (grep refund = 0 hits). The most common failure (YouTube bot-wall on datacenter IP) + ASRTimeout are exactly this path, so paying users routinely lose credits for zero output. A `refund` ledger enum already exists but was never wired. FIX: write a compensating grantCredits(+1, reason=refund:<videoId>) on terminal/error, or a reconciliation cron.

### SEC-0025 — CI does not gate build/deploy pipeline

**Severity:** HIGH  ·  **Component:** `scribuo-cicd`  ·  **CWE:** CWE-1188  ·  **Location:** `.github/workflows/ci.yml + build-*.yml + deploy-staging.yml`

CI (typecheck/lint/tests) and build-* are independent push-triggered workflows; build has no needs: on CI. Merge builds :latest and deploy-staging fires on build success regardless of CI. Lint disabled in-build (ignoreDuringBuilds), unit tests never run in Docker build. No smoke gate before prod promote. Broken code reaches staging clean. FIX: make build-* need a passing CI job (or gate deploy on CI conclusion); require Playwright smoke vs staging before a prod build.

### SEC-0026 — Sentinel alert-ingest trusts the browser report token

**Severity:** HIGH  ·  **Component:** `sentinel`  ·  **CWE:** CWE-863  ·  **Location:** `sentinel/code/app/api/ingest/alerts/route.ts:164; lib/ingest-auth.ts:177-182`

The public alert-ingest route accepts OPS_REPORT_TOKEN (the low-priv token shipped to the browser in the report-issue widget), not just OPS_INGEST_SECRET. Anyone who reads that token can create noise incidents AND send status:resolved to flip real open incidents to resolved by dedup_key — suppress/erase incidents in the security console itself. FIX: give alert-ingest its own dedicated secret (OPS_ALERTS_TOKEN) or require the privileged OPS_INGEST_SECRET.

### SEC-0027 — No DMARC record on bentech.dev (email spoofable)

**Severity:** HIGH  ·  **Component:** `dns-cloudflare`  ·  **CWE:** CWE-290  ·  **Location:** `_dmarc.bentech.dev (missing)`

SPF + DKIM present but no _dmarc TXT → receivers won't quarantine/reject spoofed mail; domain is spoofable for phishing. scribuo.com planned DMARC is only p=none (report-only). FIX: publish _dmarc with p=quarantine→reject after monitoring; tighten scribuo.com beyond p=none.

### SEC-0028 — drizzle-orm SQLi via unescaped identifiers (CVE-2026-39356)

**Severity:** HIGH  ·  **Component:** `scribuo-db`  ·  **CWE:** CWE-89  ·  **Location:** `packages/db, packages/tiers, services/api-gateway (drizzle-orm 0.36.4)`

Live data layer on 0.36.4; GHSA-gpj5-g38j-94v9 fixed in 0.45.2. Exploit needs user-controlled SQL identifiers; sampled queries use static identifiers + parameterised values (not obviously reachable) but it is the ORM on every request path. FIX: bump drizzle-orm → 0.45.2, run the db/query suite (top-priority dependency bump).

### SEC-0029 — Two DigitalOcean origins behind bentech.dev — verify ownership

**Severity:** HIGH  ·  **Component:** `dns-cloudflare`  ·  **CWE:** CWE-350  ·  **Location:** `bentech.dev → 206.189.21.117, openclaw.bentech.dev → 68.183.47.134`

Apex + openclaw resolve to DigitalOcean droplet IPs distinct from the OVH box, both on proxied/NPM hostnames. If a droplet was destroyed and the IP reassigned = subdomain/host hijack. FIX: verify both droplets are still live+owned; remove records if stale.

## Medium findings

### SEC-0030 — Prod stack is single-replica; worker concurrency-1

**Severity:** MEDIUM  ·  **Component:** `infra-swarm`  ·  **CWE:** CWE-1188  ·  **Location:** `deploy/prod/*.yml (replicas:1), worker.py:646`

Every prod service replicas:1 (PG/Redis/MinIO single, worker concurrency-1 CPU-bound). Node/container blip = full outage; throughput is one transcription at a time (bursts queue serially behind multi-minute ASR). FIX: run stateless web/api-gateway at replicas:2 now; separate a captions fast-lane from the ASR lane / scale ASR workers; DB/Redis/MinIO HA when 2nd host lands.

### SEC-0031 — /metrics fails open (serves unauth) when METRICS_TOKEN unset

**Severity:** MEDIUM  ·  **Component:** `scribuo-observability`  ·  **CWE:** CWE-306  ·  **Location:** `packages/observability/src/metrics-route.ts:45-56`

When METRICS_TOKEN is unset the handler serves the full Prometheus exposition unauthenticated, and /metrics is a public route in all 3 apps → world-readable internal counters/user-job volumes/error rates if the env var is ever missing. FIX: fail closed (404) in production when the token is unset.

### SEC-0032 — CSP allows unsafe-inline AND unsafe-eval on script-src

**Severity:** MEDIUM  ·  **Component:** `scribuo-web`  ·  **CWE:** CWE-1021  ·  **Location:** `apps/web/next.config.ts:24 (admin/kb similar)`

script-src includes 'unsafe-inline' + 'unsafe-eval' → any HTML-injection sink becomes executable script; CSP reduced to a host allowlist. FIX: move to per-request nonces + strict-dynamic and drop unsafe-eval (Clerk does not need it at runtime).

### SEC-0033 — support role can grant credits + change tier via API

**Severity:** MEDIUM  ·  **Component:** `scribuo-admin`  ·  **CWE:** CWE-863  ·  **Location:** `apps/admin/app/api/admin/users/[id]/{grant-credits,tier,suspend}/route.ts`

These routes gate on requireAdmin (global_admin OR support) while the admin UI is global_admin-only. A support user who can't load the console can still call them directly to mint credits + move billing tiers (financial authority). Role changes are correctly global_admin-only. FIX: raise these to requireGlobalAdmin if support isn't meant to have billing authority.

### SEC-0034 — advisory-board: unauth CSRF triggers paid model runs

**Severity:** MEDIUM  ·  **Component:** `advisory-board`  ·  **CWE:** CWE-352  ·  **Location:** `advisory-board/panel.py do_POST /api/run`

The :8765 panel has no auth and no Origin/CSRF check; _read_json_body ignores Content-Type so a malicious site can fire a simple cross-origin POST that starts a paid board run (~10-22 model calls); client controls the model (can pick claude-opus-4-8). Localhost-bound (mitigates). FIX: add an auth token + Origin/Host allowlist.

### SEC-0035 — advisory-board: max_reruns server-side unbounded

**Severity:** MEDIUM  ·  **Component:** `advisory-board`  ·  **CWE:** CWE-770  ·  **Location:** `advisory-board/panel.py do_POST`

max_reruns is floored at 0 but has no upper bound (HTML max=5 is client-only); max_reruns:1000 multiplies run cost without limit. Combined with the CSRF above = unauthenticated unbounded Anthropic/Gemini bill. FIX: clamp server-side (≤5).

### SEC-0036 — advisory-board: JSON file path traversal (LFI)

**Severity:** MEDIUM  ·  **Component:** `advisory-board`  ·  **CWE:** CWE-22  ·  **Location:** `advisory-board/panel.py do_GET /api/session; store.py load_session`

?id= with a path separator is treated as a literal filesystem path → returns json.load() of any JSON-parseable file the process can read, unauthenticated (localhost). FIX: reject any id that isn't a bare session_* stem; no path separators.

### SEC-0037 — Shared Supabase service_role key across v1 + Sentinel

**Severity:** MEDIUM  ·  **Component:** `identity`  ·  **CWE:** CWE-522  ·  **Location:** `sentinel/code/.env.local, lib/supabase.ts`

Sentinel uses a service_role Supabase client with the same key names as YT. If it is YT's prod key, the ops console (large attack surface: socket-proxy, metric fetchers, public ingest) holds an RLS-bypassing key to all YT customer data. FIX: verify the key is scoped/non-prod; rotate independently.

### SEC-0038 — Hermes/Open-WebUI LLM API key plaintext on disk

**Severity:** MEDIUM  ·  **Component:** `secrets-disk`  ·  **CWE:** CWE-312  ·  **Location:** `C:\dev\hermes.env`

Self-hosted LLM (Open WebUI) API key + base URL in cleartext → cost-abuse of the self-hosted LLM. FIX: rotate, keep off disk.

### SEC-0039 — SSRF via yt-dlp on unanchored URL regex (yt-whisper-summary)

**Severity:** MEDIUM  ·  **Component:** `side-whisper`  ·  **CWE:** CWE-918  ·  **Location:** `app-ha/lib/transcript.ts:40-53 → whisper-worker/worker.py:143`

extractYouTubeId regex is unanchored; the raw un-canonicalised URL reaches the worker's yt-dlp (auth + 2 non-default flags required). FIX: rebuild a canonical URL from the validated 11-char id; block private/metadata IPs in the worker.

### SEC-0040 — SSRF + weak JWT checks in aggregator-platform

**Severity:** MEDIUM  ·  **Component:** `side-aggregator`  ·  **CWE:** CWE-918  ·  **Location:** `aggregator-platform/scraper.py:52-67,92; auth.py:33-47; app.py:325-330`

Admin feed_url + third-party feed links fetched server-side with no scheme/IP validation, redirects followed (feedparser may accept file://). Clerk JWT verified without azp/iss/aud checks (risky on shared estate Clerk). Unauth /api/feeds enumerates all tenants. FIX: validate/allowlist URL scheme+IP, block private ranges, verify azp/iss/aud, auth /api/feeds.

### SEC-0041 — _spring weak admin auth + default Flask secret

**Severity:** MEDIUM  ·  **Component:** `side-spring`  ·  **CWE:** CWE-798  ·  **Location:** `_spring/app.py:14; admin/routes.py:27-36`

FLASK_SECRET_KEY defaults to literal 'dev' (forgeable is_admin cookie if unset); admin gated by a single shared secret with non-constant-time == and no rate-limit/lockout. FIX: require a strong secret at boot, constant-time compare, lockout.

### SEC-0042 — Phantom @yt/license package; entitlement logic duplicated

**Severity:** MEDIUM  ·  **Component:** `scribuo-arch`  ·  **CWE:** CWE-710  ·  **Location:** `tsconfig.base.json alias + 8x TODO(license) routes`

@yt/license is aliased but packages/license/ does not exist; entitlement gating is copy-pasted across ~8 route handlers (two upload paths + gateway), easy to drift inconsistently. FIX: create the real @yt/license package and centralise the gates.

### SEC-0043 — Admin support-notes page throws in prod (half-built)

**Severity:** MEDIUM  ·  **Component:** `scribuo-admin`  ·  **CWE:** CWE-710  ·  **Location:** `packages/db/src/queries/admin.ts createSupportNote/listSupportNote`

createSupportNote() throws 'not implemented — no support_notes table' and listSupportNotes() returns [], yet the admin support-notes page is wired to them → admin action hits a thrown error. FIX: add the support_notes table+migration+helpers, or hide the UI.

### SEC-0044 — Financial + auth core has zero automated tests

**Severity:** MEDIUM  ·  **Component:** `scribuo-tests`  ·  **CWE:** CWE-1188  ·  **Location:** `packages/db (1 test/35 files), packages/billing (0)`

claimTranscriptionSlot (money debit, FOR UPDATE, dual-pool ordering, org path) and handleStripeWebhook (signature+idempotency+grants) are the financial core and are untested; a regression silently corrupts balances. FIX: unit-test both money paths + the queue↔worker payload contract.

### SEC-0045 — Redis durability/auth gaps

**Severity:** MEDIUM  ·  **Component:** `infra-redis`  ·  **CWE:** CWE-311  ·  **Location:** `stacks redis(15) RDB-only 60s; yt-v2-prod-redis(37)/staging(31) no auth`

Legacy Redis is RDB-only (--save 60 1, no AOF) → up to 60s of BullMQ job state lost on crash; prod/staging Redis single-instance with no password. FIX: enable appendonly on legacy Redis; add a password secret to prod Redis (entrypoint supports redis_password).

### SEC-0046 — Clerk: password enabled but not a first factor; no MFA

**Severity:** MEDIUM  ·  **Component:** `clerk`  ·  **CWE:** CWE-1390  ·  **Location:** `clerk.scribuo.com FAPI (password used_for_first_factor=false)`

Users are forced to set a password at sign-up they can never sign in with (real factors = email code + Google); no second factor/MFA on the production identity. FIX: remove password or make it a real first factor; enable MFA (TOTP/passkey).

### SEC-0047 — HSTS/force-SSL disabled on all NPM proxy hosts

**Severity:** MEDIUM  ·  **Component:** `infra-npm`  ·  **CWE:** CWE-319  ·  **Location:** `NPM proxy hosts (hsts_enabled:false ×22, forceSSL:false on many)`

No HSTS on any host; force-SSL off on bentech.dev/ops/portainer/staging etc. → downgrade/SSL-strip exposure. FIX: enable HSTS + force-SSL on all real hosts; add missing origin certs.

### SEC-0048 — Dependabot disabled on live v1 + sentinel repos

**Severity:** MEDIUM  ·  **Component:** `scribuo-cicd`  ·  **CWE:** CWE-1104  ·  **Location:** `lewis159/youtube-transcriber, lewis159/sentinel`

Both are live-deployed (v1 prod, sentinel at ops.bentech.dev) yet have Dependabot alerts disabled = no dependency-vuln visibility. FIX: enable Dependabot on both.

### SEC-0049 — Flat yt-shared overlay bridges prod/staging/side-projects

**Severity:** MEDIUM  ·  **Component:** `infra-swarm`  ·  **CWE:** CWE-923  ·  **Location:** `network yt-shared (18 services)`

prod (yt-v2-prod-*), staging, side-project (springsteen-news) and infra (Infisical, PostgREST, MinIO, Grafana, socket-proxy) all share one non-internal overlay. A compromised low-value side-project has L3 reachability to prod DB REST/MinIO/Infisical. FIX: split prod/staging/side-project buses; only co-locate what must talk.

### SEC-0050 — app-ha admin dev-bypass fails open on non-prod

**Severity:** MEDIUM  ·  **Component:** `yt-v1`  ·  **CWE:** CWE-697  ·  **Location:** `youtube-transcriber/app-ha/lib/admin-auth.ts:33-42,78-88`

If SUPABASE_URL is unset/contains 'placeholder' and NODE_ENV!=production, the role check is skipped and any signed-in user is treated as admin. Fails closed in prod; risk is a reachable staging with a placeholder URL. FIX: assert staging never runs with a placeholder Supabase URL / remove the bypass.

## Low / hardening findings

### SEC-0051 — Untrusted storageKey prefix-only check on upload

**Severity:** LOW  ·  **Component:** `scribuo-web`  ·  **CWE:** CWE-22  ·  **Location:** `apps/web/app/api/videos/upload-file/route.ts:64`

storageKey validated with startsWith('uploads/<uid>/') but no '..' reject. Not exploitable today (flat UUID keys, object must pre-exist from a user-owned presign) but add normalization/'..' reject for defense-in-depth.

### SEC-0052 — Chat rate-limiter is in-memory per-instance

**Severity:** LOW  ·  **Component:** `scribuo-web`  ·  **CWE:** CWE-770  ·  **Location:** `apps/web/app/api/videos/[id]/chat/route.ts:28-35`

30/hr chat cap is per-replica in-memory → effective cap ×replica count; already TODO(HA). Move to the shared Redis limiter before web scales out.

### SEC-0053 — API-key scopes stored but never validated

**Severity:** LOW  ·  **Component:** `scribuo-db`  ·  **CWE:** CWE-20  ·  **Location:** `packages/db/src/queries/apikeys.ts:57-76`

Scopes accept any string array and aren't used for authz today (gateway gates on api_access feature). Validate/allowlist before scopes ever gate anything.

### SEC-0054 — crypto-bot REST binds 0.0.0.0 (port-map mitigates)

**Severity:** LOW  ·  **Component:** `side-crypto`  ·  **CWE:** CWE-668  ·  **Location:** `crypto-bot/user_data/config.json:53`

listen_ip_address 0.0.0.0; safe only because docker-compose maps 127.0.0.1:8080. Set the bind to 127.0.0.1 so safety doesn't depend solely on the port map. (Paper-trading confirmed, no live exchange keys.)

### SEC-0055 — jspdf 2 majors behind (low real risk)

**Severity:** LOW  ·  **Component:** `scribuo-deps`  ·  **CWE:** CWE-1104  ·  **Location:** `packages/export (jspdf 2.5.2 → 4.2.1)`

6 crit/high jsPDF CVEs need AcroForm/image/HTML APIs the code never calls (text-only). Bump to 4.2.1 clears ~18 dompurify + 8 jspdf alerts as defense-in-depth; contained migration (2 files).

### SEC-0056 — ~42GB dangling images + orphan volume/network + dead route

**Severity:** LOW  ·  **Component:** `infra-cleanup`  ·  **CWE:** CWE-1188  ·  **Location:** `73 dangling images, volume yt_v2_whisper_models, network clawbot, NPM host ops-staging.bentech.dev`

73 dangling images ≈41.8GB reclaimable; dangling volume yt_v2_whisper_models; orphan overlay 'clawbot'; NPM host ops-staging.bentech.dev → nonexistent backend; one-shot stacks migrator(40)/kbseed(47) exited but present, minio-init(46) still running. FIX: prune (verify clawbot has no tasks first); remove dead route; remove completed one-shot stacks; investigate minio-init.

### SEC-0057 — Dead/duplicate repos + stale capture dumps on disk

**Severity:** LOW  ·  **Component:** `legacy-repos`  ·  **CWE:** CWE-1188  ·  **Location:** `C:\dev yt-wt-*, yt-whisper-summary, _cap_*, _spring`

7 yt-wt-* clones + yt-whisper-summary are dead V1 clones on stale branches; _cap_sentinel/_cap_storage/_cap_yt + _cap_*.json are stale bentech-infra captures; _spring superseded by aggregator-platform. FIX: confirm branches pushed, then delete local clones + capture dumps.

## Remediation & product roadmap

All items are individual cards in the scribuo admin roadmap (`roadmap_items`), grouped by sprint via the `category` field. Sprint 0 is the security remediation drawn from the findings above.

### Sprint 0 — Security remediation

| Item | Priority | Status |
|---|---|---|
| Deploy backups + test restore | critical | planned |
| Rotate exposed secrets + delete capture dumps | critical | planned |
| Remove raw docker.sock from app containers | critical | planned |
| Move inline prod secrets to Docker secrets | high | planned |
| Fix anon rate-limit IP + require Turnstile | high | planned |
| Gate deploys on CI + staging smoke | high | planned |
| Refund credits on failed transcription | high | planned |
| Put infra UIs behind Cloudflare proxy + Access | high | planned |
| Add DMARC (bentech.dev + tighten scribuo.com) | medium | planned |
| Sentinel: separate alert-ingest secret | high | planned |
| Lock down advisory-board panel | medium | planned |
| Bump drizzle-orm to 0.45.2 | medium | planned |
| Build drag-drop sprint board | high | planned |

### Sprint 1 — Activate revenue

| Item | Priority | Status |
|---|---|---|
| Wire Stripe live billing end-to-end | critical | in progress |
| Clerk prod webhook (welcome + org sync) | high | in progress |
| Wire Resend transactional email | high | in progress |
| Enable teams / org per-seat billing | high | planned |
| Annual billing prices | medium | planned |
| Launch discount codes | medium | planned |

### Sprint 2 — Trust & safety

| Item | Priority | Status |
|---|---|---|
| Ship monitoring P0 (metrics + alerts to Sentinel) | high | in progress |
| Test suite T0 + billing/auth coverage | high | in progress |
| Activate anonymous free-transcribe | high | in progress |
| Isolate anon worker queue | medium | planned |
| Retrofit secrets to Infisical + deploy-inject | medium | planned |

### Sprint 3 — Support & admin ops

| Item | Priority | Status |
|---|---|---|
| Support notes table + wire UI | high | planned |
| Admin billing view + refunds | high | planned |
| User suspend (schema + enforcement) | medium | planned |
| Read-only user impersonation | medium | planned |
| Per-user/org rate-limit controls | medium | planned |
| On-site RAG support chat widget | high | planned |

### Sprint 4 — Stickiness features

| Item | Priority | Status |
|---|---|---|
| Bulk playlist import + RSS ingest | high | planned |
| Notion export | high | planned |
| Speaker diarisation (API-backed) | medium | planned |
| Key quotes + action items extraction | medium | planned |
| Obsidian / Markdown + VTT export | medium | planned |
| Timestamp deep-links + re-transcribe | low | planned |

### Sprint 5 — Packaging & scale-up

| Item | Priority | Status |
|---|---|---|
| New tiers: Business + Reseller/Agency | high | planned |
| Tier limits -> admin-editable DB | medium | planned |
| Metered media: auto vertical clips | high | planned |
| Metered media: caption render + audiogram | medium | planned |
| AI dubbing (Scribuo Dub) | medium | planned |
| Priority-processing queue (paid fast-lane) | medium | planned |

### Sprint 6 — Platform / deferred

| Item | Priority | Status |
|---|---|---|
| Create the real @yt/license package | medium | planned |
| Estate Clerk identity (bentech.dev IdP) | medium | planned |
| White-label share pages | medium | planned |
| Admin analytics dashboards | medium | planned |
| Docker container monitor (admin) | low | planned |
| Chrome extension | medium | planned |
| Prod Postgres HA (Patroni) | medium | planned |
| Auto-scaling controller (Swarm) | low | planned |

## Scope & method

Nine independent read-only agents ran in parallel, one per domain, then findings were deduplicated, severity-ranked and loaded into Sentinel. No changes were made during the review.

- Dependency & supply-chain (all repos + Dependabot)
- scribuo V2 application security
- V1 / Sentinel / advisory-board application security
- Side-projects + secrets-on-disk
- Host / Swarm / infrastructure (live)
- Database / HA / backups / resilience
- Technical / architecture / tests / CI
- Legacy debt / orphans / DNS / identity
- Feature backlog & sprint synthesis

_Findings register: [Findings](/findings) (SEC-0010 … SEC-0057). Roadmap: admin.scribuo.com → Roadmap. A branded PDF of this report is also archived offline._
