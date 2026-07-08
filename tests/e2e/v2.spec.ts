import { test, expect } from '@playwright/test';

/**
 * Sentinel v2 — authed E2E, driven by the TEST-ONLY auth shim.
 *
 * The dedicated dev server on :3100 runs with E2E_TEST_MODE=1 (double-gated:
 * also requires NODE_ENV !== 'production'), so getSessionRole()/getSessionAccess()
 * return a synthetic admin instead of hitting Clerk. Per-test identity is tuned
 * with request headers:
 *   - x-e2e-role      → role (default 'global_admin')
 *   - x-e2e-sections  → comma-separated section override (optional)
 * No real Clerk session, secrets, or testing tokens are required.
 */

test.describe('v2 (authed via E2E shim, default global_admin)', () => {
  test('Overview loads with shell + nav', async ({ page }) => {
    await page.goto('/v2', { waitUntil: 'domcontentloaded' });

    // Page heading.
    await expect(page.getByRole('heading', { name: 'Estate overview' })).toBeVisible();

    // Sidebar brand + a rail section (global_admin sees everything).
    const rail = page.locator('.v2-rail');
    await expect(rail).toContainText('SENTINEL');
    await expect(rail.getByText('Support', { exact: true })).toBeVisible();
  });

  test('Widget grid edit mode reveals the edit toolbar', async ({ page }) => {
    await page.goto('/v2', { waitUntil: 'domcontentloaded' });

    // The grid is loaded client-side (dynamic ssr:false); wait for it to mount,
    // which also confirms the client tree (incl. the edit toggle) has hydrated.
    await expect(page.locator('.react-grid-layout')).toBeVisible();

    // Toggle edit mode. Guard against clicking before hydration attaches the
    // handler: retry the click ONLY while the "Edit layout" label is showing
    // (it flips to "Done" once edit mode is on), so we never toggle back off.
    await expect(async () => {
      const editBtn = page.getByRole('button', { name: 'Edit layout' });
      if (await editBtn.isVisible().catch(() => false)) {
        await editBtn.click();
      }
      await expect(page.getByRole('button', { name: /Add widget/ })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });

    // WidgetGrid edit toolbar affordances (real labels from WidgetGrid.tsx).
    await expect(page.getByRole('button', { name: /Add widget/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset layout' })).toBeVisible();
  });

  test('Hermes copilot draft flow (LLM mocked at the browser boundary)', async ({ page }) => {
    // Intercept the Hermes triage call BEFORE it fires; return a deterministic
    // proposal so the test never depends on a real OpenRouter key.
    await page.route('**/api/hermes/triage', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          configured: true,
          classification: 'Billing · refund',
          priority: 'high',
          draft: 'Hi — I have refunded the duplicate charge.',
          sources: ['rate-limiting'],
          confidence: 88,
          reasoning: 'test',
          model: 'test',
          id: null,
        }),
      }),
    );

    // OPS-0007 is a real ticket ref (see lib/mock.ts → tickets).
    await page.goto('/v2/support/OPS-0007', { waitUntil: 'domcontentloaded' });

    // The support copilot panel button (AGENT_META.support.button = 'Draft a reply').
    const draftBtn = page.getByRole('button', { name: 'Draft a reply' });
    await expect(draftBtn).toBeVisible();

    // Click to run triage. Guard against pre-hydration clicks: retry while the
    // button is still present (it's replaced by Send/Regenerate once the draft
    // renders), then assert the mocked draft landed in the editable textarea.
    const textarea = page.locator('.v2-hz-textarea');
    await expect(async () => {
      if (await draftBtn.isVisible().catch(() => false)) {
        await draftBtn.click();
      }
      await expect(textarea).toHaveValue(/refunded the duplicate charge/, {
        timeout: 3_000,
      });
    }).toPass({ timeout: 30_000 });

    // Classification + confidence render alongside the draft.
    await expect(page.getByText('Billing · refund')).toBeVisible();
    await expect(page.getByText('88%')).toBeVisible();
  });
});

test.describe('v2 RBAC hiding (section-limited identity)', () => {
  // A non-admin role is required for the section override to apply: resolveSections
  // short-circuits and grants EVERYTHING to global_admin, so a section override is
  // only meaningful for a lesser role. 'viewer' + explicit sections → exactly
  // [overview, support].
  test.use({
    extraHTTPHeaders: {
      'x-e2e-role': 'viewer',
      'x-e2e-sections': 'overview,support',
    },
  });

  test('rail hides ungranted sections; deep-link redirects to unauthorized', async ({
    page,
  }) => {
    await page.goto('/v2', { waitUntil: 'domcontentloaded' });

    const rail = page.locator('.v2-rail');
    // Granted → visible.
    await expect(rail.getByText('Support', { exact: true })).toBeVisible();
    // Ungranted → not rendered at all.
    await expect(rail.getByText('Operations', { exact: true })).toHaveCount(0);
    await expect(rail.getByText('Security', { exact: true })).toHaveCount(0);
    await expect(rail.getByText('Admin', { exact: true })).toHaveCount(0);

    // Server-side gate: deep-linking an ungranted section redirects.
    await page.goto('/v2/operations', { waitUntil: 'domcontentloaded' });

    const onUnauthorized = page.url().includes('/v2/unauthorized');
    const noAccessHeading = await page
      .getByRole('heading', { name: /No access/i })
      .isVisible()
      .catch(() => false);
    expect(
      onUnauthorized || noAccessHeading,
      `expected /v2/unauthorized or a "No access" heading; got URL ${page.url()}`,
    ).toBeTruthy();
  });
});
