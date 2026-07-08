# Sentinel E2E tests (Playwright)

End-to-end tests for the Sentinel Next.js app.

## Layout

- `smoke.spec.ts` — runnable **without authentication**. Hits the public
  `/api/ping` endpoint and verifies the Clerk middleware redirects protected
  routes (`/` and `/v2`) to sign-in. Use this as the default CI smoke suite.
- `v2.authed.spec.ts` — **skipped** scaffold for authenticated v2 feature checks.
  Enable once Clerk testing tokens are wired (see below).

## Running the smoke suite (no auth needed)

From the repo root (`C:\dev\sentinel\code`):

```bash
npm i
npx playwright install chromium
npm run test:e2e
```

- `npm run test:e2e` runs `playwright test`.
- `npm run test:e2e:ui` opens the interactive Playwright UI.

### How the app under test is provided

- **Default:** with `E2E_BASE_URL` unset, Playwright starts the app itself via
  `npm run dev` on port 3000 (`reuseExistingServer: true`, so an already-running
  dev server is reused). No manual server start needed.
- **Against a running instance:** set `E2E_BASE_URL` to skip the built-in dev
  server and test that target as-is:

  ```bash
  # bash / sh
  E2E_BASE_URL=https://ops.bentech.dev npm run test:e2e
  ```

  ```powershell
  # PowerShell
  $env:E2E_BASE_URL = 'https://ops.bentech.dev'; npm run test:e2e
  ```

> Note: the smoke suite only asserts public behavior and redirects, so it passes
> against any environment where the app is up — no Clerk secrets required.

## Enabling the authenticated suite later

`v2.authed.spec.ts` is wrapped in `test.describe.skip(...)`. To turn it on:

1. Dependencies are already in `package.json`: `@playwright/test` and
   `@clerk/testing`.
2. Provide env vars from a Clerk **test/dev** instance:

   ```
   CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   ```

   Also provision a test user that maps to a Sentinel `global_admin`, since the
   `/v2` pages call `requireGlobalAdminPage()`.
3. Bootstrap the Clerk testing token before the browser context is created —
   either a `globalSetup` calling `clerkSetup()`, or
   `setupClerkTestingToken({ page })` in a `beforeEach` (both from
   `@clerk/testing/playwright`; the import is stubbed at the top of the spec).
4. Establish an authenticated session (drive the Clerk sign-in flow with a test
   email + code, or seed `storageState`).
5. Remove `.skip` from the `describe` block.

Reference: https://clerk.com/docs/testing/playwright/overview
