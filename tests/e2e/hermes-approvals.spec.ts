import { test, expect, type Route } from '@playwright/test';

/**
 * Hermes approval queue — the visible HUMAN GATE for gated Brain actions.
 *
 * Driven against the dedicated E2E-mode server (:3100) with the TEST-ONLY auth
 * shim (E2E_TEST_MODE=1, double-gated). The approvals page is section-gated
 * (`requireSectionPage('hermes')`) — the default shim identity is global_admin,
 * which satisfies every section, so no per-test header is needed.
 *
 * HERMETIC: the queue's data (`GET /api/hermes/proposals`) and the approve/deny
 * mutations are stubbed at the browser boundary, so these tests never depend on a
 * real Postgres, a Brain run, or live proposal data. A closure flag flips the
 * stubbed feed's status after the mutation so the component's post-action SWR
 * revalidation observes the decided row (not the original pending one).
 */

// A pending ACTION proposal (a gated tool call the Brain paused on). Shape mirrors
// HermesProposalRecord (lib/hermes/proposals.ts) + HermesProposal.action.
function pendingActionProposal() {
  return {
    id: 'e2e-prop-1',
    ref: 'OPS-0007',
    agent: 'support',
    kind: 'action',
    title: 'Resolve the duplicate-charge ticket',
    summary: 'Mark the ticket resolved after the refund cleared',
    status: 'pending',
    createdAt: new Date().toISOString(),
    proposal: {
      ok: true,
      configured: true,
      priority: 'high',
      classification: 'Billing · refund',
      action: {
        tool: 'updateTicket',
        args: { ref: 'OPS-0007', status: 'resolved' },
        threadId: 'discord:123',
        persona: 'support',
      },
    },
  };
}

test.describe('Hermes approval queue (feed + mutations stubbed)', () => {
  test('renders a pending action card showing exactly what will execute', async ({
    page,
  }) => {
    await page.route('**/api/hermes/proposals', (route: Route) =>
      route.fulfill({ json: { live: true, proposals: [pendingActionProposal()] } }),
    );

    await page.goto('/v2/hermes/approvals', { waitUntil: 'domcontentloaded' });

    // Page header renders (server component).
    await expect(page.getByRole('heading', { name: 'Approval queue' })).toBeVisible();

    // The card renders the proposal title + the "Pending review" pill.
    await expect(page.getByText('Resolve the duplicate-charge ticket')).toBeVisible();
    await expect(page.getByText('Pending review')).toBeVisible();

    // The gated tool is surfaced (the audit affordance) — tool name + the
    // "what will execute" disclosure with its args.
    await expect(page.getByText('What will execute')).toBeVisible();
    await expect(page.locator('.v2-apq-tool')).toContainText('updateTicket');
    // Args are in the DOM inside the <details> (textContent assert — no need to
    // expand): the reviewer can audit tool + args before approving.
    await expect(page.locator('.v2-apq-args')).toContainText('"status": "resolved"');

    // The human gate: an "Approve & run" button (action proposals) + a Deny control.
    await expect(page.getByRole('button', { name: 'Approve & run' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();
  });

  test('Approve hits the approve endpoint and flips the row to Executed', async ({
    page,
  }) => {
    let approved = false;

    await page.route('**/api/hermes/proposals', (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const rec = pendingActionProposal();
      rec.status = approved ? 'sent' : 'pending';
      return route.fulfill({ json: { live: true, proposals: [rec] } });
    });

    let approveCalled = false;
    await page.route('**/api/hermes/proposals/*/approve', (route: Route) => {
      approveCalled = true;
      approved = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto('/v2/hermes/approvals', { waitUntil: 'domcontentloaded' });

    const approveBtn = page.getByRole('button', { name: 'Approve & run' });
    // Guard against a pre-hydration click: retry only while the button is present
    // (it's replaced by the read-only "Executed" state once the action resolves).
    await expect(async () => {
      if (await approveBtn.isVisible().catch(() => false)) {
        await approveBtn.click();
      }
      await expect(page.getByText('Executed')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    expect(approveCalled, 'the approve endpoint should have been called').toBe(true);
    // Row is now read-only — the Approve control is gone.
    await expect(page.getByRole('button', { name: 'Approve & run' })).toHaveCount(0);
  });

  test('Deny hits the deny endpoint and flips the row to Denied', async ({ page }) => {
    let denied = false;

    await page.route('**/api/hermes/proposals', (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const rec = pendingActionProposal();
      rec.status = denied ? 'dismissed' : 'pending';
      return route.fulfill({ json: { live: true, proposals: [rec] } });
    });

    let denyCalled = false;
    await page.route('**/api/hermes/proposals/*/deny', (route: Route) => {
      denyCalled = true;
      denied = true;
      return route.fulfill({ json: { ok: true } });
    });

    await page.goto('/v2/hermes/approvals', { waitUntil: 'domcontentloaded' });

    const denyBtn = page.getByRole('button', { name: 'Deny' });
    await expect(async () => {
      if (await denyBtn.isVisible().catch(() => false)) {
        await denyBtn.click();
      }
      await expect(page.getByText('Denied')).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    expect(denyCalled, 'the deny endpoint should have been called').toBe(true);
    await expect(page.getByRole('button', { name: 'Deny' })).toHaveCount(0);
  });
});
