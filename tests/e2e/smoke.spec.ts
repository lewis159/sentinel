import { test, expect } from '@playwright/test';

/**
 * Smoke suite — runs against the dedicated E2E-mode server (:3100).
 *
 * The TEST-ONLY auth shim (E2E_TEST_MODE=1, double-gated) bypasses Clerk, so the
 * app renders WITHOUT a real session. These tests prove the server is up and the
 * shim is wired: the public health endpoint responds, and protected app routes
 * (previously redirected to sign-in) now render the app directly.
 *
 * NOTE: the pre-shim smoke tests asserted /v2 and / REDIRECT to Clerk sign-in.
 * Under E2E mode there is no redirect, so those assertions were repurposed to
 * expect the authed app (200 + app shell) instead.
 */

test.describe('smoke (E2E shim active)', () => {
  test('GET /api/ping returns 200', async ({ request }) => {
    // /api/ping is declared public in middleware.ts (container liveness probe).
    const res = await request.get('/api/ping');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ ok: true, service: 'sentinel' });
  });

  test('/v2 renders the app under the E2E shim (no sign-in redirect)', async ({ page }) => {
    const res = await page.goto('/v2', { waitUntil: 'domcontentloaded' });

    // No redirect to Clerk sign-in.
    expect(page.url()).not.toContain('/sign-in');
    expect(res?.status()).toBe(200);

    // The v2 shell renders: brand + the estate overview heading.
    await expect(page.locator('.v2-rail')).toContainText('SENTINEL');
    await expect(page.getByRole('heading', { name: 'Estate overview' })).toBeVisible();
  });

  test('/ renders the v1 app under the E2E shim (no sign-in redirect)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    expect(page.url()).not.toContain('/sign-in');
    // The v1 shell mounts.
    await expect(page.locator('.shell')).toBeVisible();
  });
});
