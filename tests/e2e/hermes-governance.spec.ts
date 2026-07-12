import { test, expect, type Route } from '@playwright/test';

/**
 * Hermes Governance console — "everything is a dial".
 *
 * The page is admin-gated (`requireSectionPage('admin')`); the default E2E shim
 * identity is global_admin, so no per-test header is needed. The three sections
 * (autonomy matrix / budget caps / escalation) are client components that
 * read/write the admin-gated /api/v2/settings/hermes/* routes — all STUBBED here
 * so the test never touches Postgres or real config.
 */

// A minimal autonomy matrix payload (matches GovernanceAutonomyMatrix's Payload).
function autonomyPayload() {
  return {
    matrix: [
      {
        persona: 'support',
        tool: 'updateTicket',
        defaultMode: 'gated',
        dbMode: null,
        mode: 'gated',
        source: 'code',
      },
    ],
    personas: [{ id: 'support', label: 'Support' }],
    modes: ['auto', 'gated', 'draft_only'],
  };
}

test.describe('Hermes governance console (settings APIs stubbed)', () => {
  test.beforeEach(async ({ page }) => {
    // Budget caps + escalation feeds — stub so their cards render without a DB.
    await page.route('**/api/v2/settings/hermes/budgets', (route: Route) =>
      route.fulfill({
        json: {
          caps: [],
          personas: [{ id: 'support', label: 'Support' }],
          windows: [{ key: 'day', label: 'per day', seconds: 86_400 }],
        },
      }),
    );
    await page.route('**/api/v2/settings/hermes/thresholds', (route: Route) =>
      route.fulfill({ json: { thresholds: {}, ladder: [] } }),
    );
  });

  test('renders the autonomy matrix + budget cap + escalation cards', async ({
    page,
  }) => {
    await page.route('**/api/v2/settings/hermes/autonomy', (route: Route) =>
      route.fulfill({ json: autonomyPayload() }),
    );

    await page.goto('/v2/hermes/governance', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Governance console' })).toBeVisible();
    // The three governance section headings (server-rendered).
    await expect(page.getByRole('heading', { name: 'Autonomy matrix' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Budget caps' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Escalation' })).toBeVisible();

    // The matrix body hydrated from the stubbed feed: the tool row + its dial.
    await expect(page.getByText('updateTicket')).toBeVisible();
    await expect(page.locator('select.v2-hp-input').first()).toBeVisible();
  });

  test('toggling an autonomy dial posts the change to the settings API', async ({
    page,
  }) => {
    await page.route('**/api/v2/settings/hermes/autonomy', (route: Route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: autonomyPayload() });
    });

    await page.goto('/v2/hermes/governance', { waitUntil: 'domcontentloaded' });

    const dial = page.locator('select.v2-hp-input').first();
    await expect(dial).toBeVisible();

    // Flip the dial gated → auto; this makes the row dirty and enables Save.
    await dial.selectOption('auto');

    // Wait for the POST that the Save click triggers, and assert it carried our
    // change. Retry the click guard against pre-hydration handler attachment.
    const saveBtn = page.getByRole('button', { name: /Save 1 change/ });
    await expect(saveBtn).toBeVisible();

    const [postReq] = await Promise.all([
      page.waitForRequest(
        (r) =>
          r.url().includes('/api/v2/settings/hermes/autonomy') && r.method() === 'POST',
      ),
      saveBtn.click(),
    ]);

    const body = postReq.postDataJSON() as {
      tools?: { persona: string; tool: string; mode: string }[];
    };
    expect(body.tools?.[0]).toMatchObject({
      persona: 'support',
      tool: 'updateTicket',
      mode: 'auto',
    });

    // The UI confirms the save.
    await expect(page.getByText('Saved ✓')).toBeVisible();
  });
});
