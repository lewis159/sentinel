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

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3100';
const USE_LOCAL_SERVER = !process.env.E2E_BASE_URL;

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
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Follow redirects and behave like a real browser navigation.
    ignoreHTTPSErrors: true,
    // Cold dev compiles can be slow; don't wait on the full 'load' event.
    navigationTimeout: 60_000,
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
        command: 'npm run dev -- -p 3100',
        url: 'http://localhost:3100',
        reuseExistingServer: false,
        env: { E2E_TEST_MODE: '1' },
        // Next dev can be slow on a cold start; give it plenty of headroom.
        timeout: 120_000,
      }
    : undefined,
});
