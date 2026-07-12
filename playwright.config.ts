import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for the Sentinel Next.js app.
 *
 * Runs a DEDICATED dev server on port 3100 (isolated from any dev server you may
 * have on :3000) with the TEST-ONLY E2E auth shim enabled via E2E_TEST_MODE=1.
 * The shim is double-gated in the app (E2E_TEST_MODE === '1' AND NODE_ENV !==
 * 'production'), so it can never activate in a real deployment.
 *
 * Override the target with E2E_BASE_URL to point at an already-running instance
 * (started yourself with E2E_TEST_MODE=1); the webServer block is then skipped.
 */

// Use the literal loopback IP, not 'localhost'. On CI runners Chromium can do
// remote DNS (via a proxy) and fail to resolve the 'localhost' hostname with
// ERR_NAME_NOT_RESOLVED, even though the Node webServer probe resolves it fine.
// A literal IP needs no DNS. (Override with E2E_BASE_URL for an external target.)
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
const USE_LOCAL_SERVER = !process.env.E2E_BASE_URL;
// Readiness is probed against the lightweight /api/ping route handler rather than
// the app root '/'. The root pulls in the whole v1 shell + provider tree, so on a
// COLD CI runner (fresh `npm ci`, no .next cache, first-ever SWC/Turbopack setup)
// compiling it can blow the webServer boot budget before the server is declared
// ready. /api/ping is a trivial handler that compiles in a few seconds, so the
// server reports ready promptly; the heavier page routes then compile lazily on
// first navigation, comfortably inside each test's own timeout.
const READY_URL = `${BASE_URL}/api/ping`;

export default defineConfig({
  testDir: './tests/e2e',
  // Fail fast in CI on accidental test.only, allow it locally.
  forbidOnly: !!process.env.CI,
  // No retries by default; these tests should be deterministic.
  retries: process.env.CI ? 1 : 0,
  // Serialize: the Next dev server compiles routes on first hit (10-15s cold),
  // and parallel requests to uncompiled routes queue behind that. One worker
  // keeps each route's cold compile inside the per-test budget.
  workers: 1,
  // Per-test timeout — generous headroom for a cold dev compile + client hydrate.
  // Bumped for CI, where a first-ever route compile (no .next cache) can be
  // several times slower than a warm local one.
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    // Never route loopback through a proxy (CI runners may set http(s)_proxy,
    // which turns a same-host request into a remote DNS lookup of 'localhost').
    launchOptions: {
      args: ['--no-proxy-server', '--proxy-bypass-list=<-loopback>'],
    },
    trace: 'on-first-retry',
    // Follow redirects and behave like a real browser navigation.
    ignoreHTTPSErrors: true,
    // Cold dev compiles can be slow; don't wait on the full 'load' event.
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Boot a dedicated E2E-mode dev server on :3100 unless an external base URL was
  // provided. reuseExistingServer:false guarantees the shim env is applied.
  webServer: USE_LOCAL_SERVER
    ? {
        command: 'npm run dev -- -p 3100 -H 0.0.0.0',
        // Probe the lightweight /api/ping route (see READY_URL) so boot doesn't
        // hang on compiling the full app shell.
        url: READY_URL,
        reuseExistingServer: false,
        // E2E_TEST_MODE=1 activates the test-only auth shim (double-gated in the
        // app), which short-circuits ALL auth logic so no real Clerk API call is
        // ever made. Clerk's <ClerkProvider> still refuses to initialise without a
        // FORMAT-VALID publishableKey, though, so we feed it throwaway DUMMY test
        // keys purely to satisfy that init check. These are NON-secret, well-known
        // Clerk test-format placeholders (not tied to any real instance) — safe to
        // inline so this works identically locally and in CI.
        env: {
          E2E_TEST_MODE: '1',
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k',
          CLERK_SECRET_KEY: 'sk_test_dummydummydummydummydummydummydummydummy',
        },
        // Next dev can be slow on a cold start; give it plenty of headroom. A
        // fresh CI runner has no .next cache and pays a one-time SWC/Turbopack
        // setup cost on the first compile, so this is deliberately generous.
        timeout: 240_000,
      }
    : undefined,
});
