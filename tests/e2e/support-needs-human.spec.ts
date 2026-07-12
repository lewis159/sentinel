import { test, expect } from '@playwright/test';

/**
 * Support "Needs human" queue — tickets waiting on a person.
 *
 * Section-gated (`requireSectionPage('support')`); the default E2E shim identity
 * is global_admin, which satisfies it. The page is fully server-rendered from
 * getNeedsHumanQueue(), which degrades to mock data with no DB — so this test is
 * hermetic without any network stubbing. We assert the page renders EITHER a
 * populated queue table OR the clear-queue empty state (robust to whatever the
 * mock fixtures currently contain).
 */

test.describe('Support needs-human queue', () => {
  test('renders its list or the empty state', async ({ page }) => {
    await page.goto('/v2/support/needs-human', { waitUntil: 'domcontentloaded' });

    // Header always renders.
    await expect(page.getByRole('heading', { name: 'Needs human' })).toBeVisible();

    // Either the queue table (populated) or the "nothing needs a human" empty state.
    const table = page.locator('table.v2-table');
    const emptyHeading = page.getByRole('heading', {
      name: 'Nothing needs a human right now',
    });

    await expect(async () => {
      const hasTable = await table.isVisible().catch(() => false);
      const hasEmpty = await emptyHeading.isVisible().catch(() => false);
      expect(
        hasTable || hasEmpty,
        'expected either the needs-human table or the empty state to render',
      ).toBeTruthy();
    }).toPass({ timeout: 30_000 });

    // The "Customer desk" link is always present in the header.
    await expect(page.getByRole('link', { name: 'Customer desk' })).toBeVisible();
  });
});
