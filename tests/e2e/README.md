# Sentinel E2E tests (Playwright)

End-to-end tests for the Sentinel Next.js app. They run against a **dedicated
E2E-mode dev server on port 3100** that Playwright boots for you, with the
TEST-ONLY auth shim enabled (`E2E_TEST_MODE=1`, double-gated so it can never
activate in a real deployment — see `middleware.ts` / `lib/auth.ts`).

## Running

```bash
npm ci
npx playwright install chromium   # one-time: download the browser
npm run test:e2e                  # = playwright test
```

- `npm run test:e2e` runs `playwright test` (boots the :3100 server itself).
- `npm run test:e2e:ui` opens the interactive Playwright UI.
- List specs without running them (no browser needed):
  `npx playwright test --list`.
- Point at an already-running instance (skips the built-in server; that target
  must itself be started with `E2E_TEST_MODE=1`):

  ```bash
  E2E_BASE_URL=http://localhost:3100 npm run test:e2e   # bash
  $env:E2E_BASE_URL='http://localhost:3100'; npm run test:e2e   # PowerShell
  ```

## How auth works (no real Clerk session)

The app is Clerk-gated, but a double-gated TEST-ONLY shim
(`E2E_TEST_MODE === '1'` **and** `NODE_ENV !== 'production'`) makes
`getSessionRole()` / `getSessionAccess()` return a synthetic identity instead of
hitting Clerk. Per-test identity is tuned with request headers:

- `x-e2e-role` → role (default `global_admin`, which satisfies every section)
- `x-e2e-sections` → comma-separated section override (only meaningful for a
  non-admin role)

No Clerk secrets or testing tokens are required for the active specs.

## Specs

- `smoke.spec.ts` — server up + shim wired (`/api/ping`, `/v2`, `/` render
  without a sign-in redirect).
- `v2.spec.ts` — authed v2 shell, RBAC hiding, and the Hermes support copilot
  draft flow (LLM mocked at the network boundary).
- `hermes-approvals.spec.ts` — the **approval queue** (human gate): a pending
  gated-action card shows the tool + args ("what will execute"); Approve/Deny hit
  the right endpoint and flip the row to Executed/Denied. Feed + mutations stubbed.
- `support-widget.spec.ts` — the embeddable **customer support-chat widget**
  (`public/support-chat.js`) loaded onto a blank fixture page: open it, ask a
  question, assert the reply bubble; plus the "Talk to a human" escalation.
  `/api/public/support/chat` is stubbed.
- `hermes-governance.spec.ts` — the **governance console**: autonomy matrix +
  budget-cap + escalation cards render; toggling an autonomy dial POSTs the change
  to the settings API. Settings APIs stubbed.
- `support-needs-human.spec.ts` — the **needs-human queue** renders its table or
  the empty state (server-rendered mock data; no stubbing needed).
- `v2.authed.spec.ts` — **skipped** scaffold for tests that need a REAL Clerk
  session (testing tokens). Enable per the notes in that file once secrets are
  wired.

## Hermetic strategy

The active specs never depend on real Postgres, a Brain run, or an LLM key:
- Most `/v2` pages degrade to **mock mode** with no `DATABASE_URL`.
- Data feeds and mutations are **stubbed via `page.route`** (role/text selectors
  over live data), so tests are deterministic.

## Typechecking the specs

The base `tsconfig.json` excludes `tests` (so the Next build ignores them). To
typecheck the specs:

```bash
node_modules/.bin/tsc -p tsconfig.e2e.json --noEmit
```

## CI

CI must run `npx playwright install --with-deps chromium` before
`npm run test:e2e` (the workflow lives on a separate branch and already calls the
`test:e2e` script). Browsers are intentionally NOT vendored in the repo.
