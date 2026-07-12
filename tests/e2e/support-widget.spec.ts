import { test, expect, type Route } from '@playwright/test';

/**
 * Customer support-chat widget (public/support-chat.js).
 *
 * The widget is the embeddable, framework-free launcher a public product site
 * (e.g. scribuo.com) drops in. It is NOT part of the authed app UI, so we load it
 * onto a BLANK fixture page served from the app origin (via a route stub) and then
 * inject the real /support-chat.js from the dev server. Because the fixture lives
 * on the app origin, the widget's relative fetch to /api/public/support/chat
 * resolves back to that origin — which we STUB, keeping the test hermetic (no
 * OPS_SUPPORT_TOKEN, no LLM, no DB).
 */

const FIXTURE_PATH = '/e2e-support-widget-host';

test.describe('support-chat widget (public embed)', () => {
  test.beforeEach(async ({ page }) => {
    // Serve a blank host page from the app origin so the widget's relative API
    // calls resolve here (and get stubbed below).
    await page.route(`**${FIXTURE_PATH}`, (route: Route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
      }),
    );
  });

  test('opens, sends a question, and renders the AI reply bubble', async ({ page }) => {
    // Stub the L1 chat endpoint the widget POSTs to.
    await page.route('**/api/public/support/chat', (route: Route) =>
      route.fulfill({
        json: {
          conversationId: 'e2e-conv-1',
          reply: 'No problem — I have sent you a password reset link.',
          ticketRef: 'OPS-1234',
        },
      }),
    );

    await page.goto(FIXTURE_PATH, { waitUntil: 'domcontentloaded' });
    // Inject the real widget bundle from the dev server (public/support-chat.js).
    // addScriptTag resolves once the script has loaded + executed.
    await page.addScriptTag({ url: '/support-chat.js' });

    // The floating launcher mounts.
    const fab = page.getByRole('button', { name: 'Open support chat' });
    await expect(fab).toBeVisible();
    await fab.click();

    // The panel (a labelled dialog) opens on the L0 self-serve home.
    await expect(page.getByRole('dialog', { name: 'Support chat' })).toBeVisible();

    // Cross into the L1 chat.
    await page.getByRole('button', { name: 'Ask a question instead' }).click();
    await expect(page.getByText('Hi! How can we help today?')).toBeVisible();

    // Type a question and send it.
    await page.locator('.shc-in').fill('I forgot my password');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    // The customer's message bubble + the stubbed reply bubble + the ticket ref.
    await expect(page.getByText('I forgot my password')).toBeVisible();
    await expect(page.getByText('I have sent you a password reset link.')).toBeVisible();
    await expect(page.getByText('Reference: OPS-1234')).toBeVisible();
  });

  test('"Talk to a human" escalates and confirms a person was notified', async ({
    page,
  }) => {
    // Stub the chat endpoint to return an escalated response.
    await page.route('**/api/public/support/chat', (route: Route) =>
      route.fulfill({
        json: {
          conversationId: 'e2e-conv-2',
          reply: 'A member of our team will be in touch shortly.',
          escalated: true,
          ticketRef: 'OPS-5678',
        },
      }),
    );

    await page.goto(FIXTURE_PATH, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ url: '/support-chat.js' });

    await page.getByRole('button', { name: 'Open support chat' }).click();
    await page.getByRole('button', { name: 'Ask a question instead' }).click();
    await page.getByRole('button', { name: 'Talk to a human' }).click();

    // The escalation posts and the widget confirms a human was notified.
    await expect(page.getByText('A member of our team has been notified.')).toBeVisible();
  });
});
