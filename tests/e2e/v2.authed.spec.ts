import { test, expect } from '@playwright/test';
// import { setupClerkTestingToken } from '@clerk/testing/playwright';

/**
 * AUTHENTICATED v2 feature suite — SCAFFOLD, currently skipped.
 *
 * Why skipped: these tests need a logged-in Clerk session. That requires Clerk
 * testing tokens + a global_admin test user, which are NOT available in the
 * current environment. The bodies below are real and intended to run once the
 * secrets are wired in CI.
 *
 * How to enable:
 *   1. Install the testing helper (already added to package.json):
 *        @clerk/testing
 *   2. Provide these env vars to the test run (from a Clerk *test/dev* instance):
 *        CLERK_PUBLISHABLE_KEY=pk_test_...
 *        CLERK_SECRET_KEY=sk_test_...
 *      (and a test user that maps to a Sentinel global_admin, since /v2 pages
 *      call requireGlobalAdminPage()).
 *   3. Bootstrap the testing token once, before the browser context is created.
 *      In playwright.config.ts add a globalSetup that calls `clerkSetup()` from
 *      '@clerk/testing/playwright', OR call setupClerkTestingToken(page) at the
 *      top of each test / in a beforeEach (uncomment the import above and the
 *      calls below).
 *   4. Establish an authenticated session — either drive the sign-in form with a
 *      Clerk test email + verification code, or seed storageState. See:
 *        https://clerk.com/docs/testing/playwright/overview
 *   5. Remove `.skip` from the describe below.
 */

test.describe.skip('v2 authed features (enable once Clerk testing tokens are wired)', () => {
  test.beforeEach(async ({ page }) => {
    // await setupClerkTestingToken({ page });
    // TODO: establish an authenticated session (storageState or sign-in flow)
    // for a user mapped to a Sentinel global_admin before navigating.
  });

  test('/v2 renders the Estate overview heading', async ({ page }) => {
    await page.goto('/v2');
    await expect(page.getByRole('heading', { name: 'Estate overview' })).toBeVisible();
  });

  test('v2 sidebar shows the 5 primary sections', async ({ page }) => {
    await page.goto('/v2');
    const sidebar = page.locator('aside.v2-rail');
    for (const label of ['Overview', 'Support', 'Operations', 'Security', 'Admin']) {
      await expect(sidebar.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('theme toggle flips data-theme on <html>', async ({ page }) => {
    await page.goto('/v2');
    const root = page.locator('html');
    const before = await root.getAttribute('data-theme');

    await page.getByRole('button', { name: 'Toggle theme' }).click();

    const after = await root.getAttribute('data-theme');
    expect(after).not.toBe(before);
    expect(['light', 'dark']).toContain(after);
  });

  test('version toggle sets the version cookie and navigates to v1', async ({ page, context }) => {
    await page.goto('/v2');

    // Mounting the v2 toggle stamps sentinel.version=v2.
    let cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'sentinel.version')?.value).toBe('v2');

    // Clicking "→ v1" flips the cookie and hard-navigates to '/'.
    await Promise.all([
      page.waitForURL('**/'),
      page.locator('button.v2-ver').click(),
    ]);

    cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'sentinel.version')?.value).toBe('v1');
  });
});
