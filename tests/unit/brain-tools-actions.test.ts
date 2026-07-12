import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unit tests for the P3 Brain ACTION tools (Stripe / Resend / GitHub). We mock the
// global fetch so no real API is hit, and assert (a) the exact outbound call shape +
// auth header for each tool, and (b) that the missing-key path returns a clean
// "not_configured" ToolResult rather than throwing.
//
// server-only is stubbed (the tools import it). @/lib/secrets.getSecret is stubbed
// to return undefined so the tools rely solely on the env keys we set here — no
// Infisical/network in the unit run.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/secrets', () => ({ getSecret: vi.fn(async () => undefined) }));

import {
  getChargeTool,
  refundChargeTool,
  issueCreditTool,
} from '@/lib/hermes/brain/tools/stripe';
import { sendEmailTool } from '@/lib/hermes/brain/tools/email';
import {
  listWorkflowRunsTool,
  triggerWorkflowTool,
  commitFileTool,
} from '@/lib/hermes/brain/tools/github';

const CTX = { threadId: 'test:1', persona: 'billing', actor: 'test' };

// A fetch mock that records the last call and returns a canned JSON response.
function mockFetch(response: { ok?: boolean; status?: number; body?: any }) {
  const fn = vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  }));
  vi.stubGlobal('fetch', fn as any);
  return fn;
}

beforeEach(() => {
  // Populate every action key so the "configured" tests exercise the real call path.
  process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
  process.env.RESEND_API = 're_test_key';
  process.env.RESEND_FROM = 'Sentinel <ops@bentech.dev>';
  process.env.HERMES_GITHUB_TOKEN = 'ghp_test_token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.RESEND_API;
  delete process.env.RESEND_FROM;
  delete process.env.HERMES_GITHUB_TOKEN;
});

describe('stripe tools', () => {
  it('all three tools default to the expected autonomy (reads auto, money gated)', () => {
    expect(getChargeTool.autonomy).toBe('auto');
    expect(refundChargeTool.autonomy).toBe('gated');
    expect(issueCreditTool.autonomy).toBe('gated');
  });

  it('getCharge GETs the charge with a Bearer key', async () => {
    const fetchFn = mockFetch({ body: { id: 'ch_1', amount: 500, currency: 'gbp', status: 'succeeded', refunded: false } });
    const res = await getChargeTool.run({ chargeId: 'ch_1' }, CTX);
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/charges/ch_1');
    expect((init as any)?.headers?.Authorization).toBe('Bearer sk_test_stripe');
  });

  it('refundCharge POSTs a form-encoded refund with charge + amount', async () => {
    const fetchFn = mockFetch({ body: { id: 're_1', amount: 500, currency: 'gbp', status: 'succeeded' } });
    const res = await refundChargeTool.run({ chargeId: 'ch_1', amount: 500 }, CTX);
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect((init as any).headers.Authorization).toBe('Bearer sk_test_stripe');
    const body = (init as any).body as string;
    expect(body).toContain('charge=ch_1');
    expect(body).toContain('amount=500');
    expect(body).toContain('reason=requested_by_customer');
  });

  it('issueCredit POSTs a NEGATIVE balance transaction (a credit)', async () => {
    const fetchFn = mockFetch({ body: { id: 'cbtxn_1', amount: -500, currency: 'gbp', ending_balance: -500 } });
    const res = await issueCreditTool.run({ customerId: 'cus_1', amount: 500, currency: 'GBP' }, CTX);
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/customers/cus_1/balance_transactions');
    const body = (init as any).body as string;
    expect(body).toContain('amount=-500');
    expect(body).toContain('currency=gbp');
  });

  it('surfaces a Stripe API error without throwing', async () => {
    mockFetch({ ok: false, status: 402, body: { error: { message: 'No such charge' } } });
    const res = await refundChargeTool.run({ chargeId: 'ch_x' }, CTX);
    expect(res.ok).toBe(false);
    expect(res.summary).toContain('No such charge');
  });

  it('missing key → not_configured (no throw), and does NOT call fetch', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const fetchFn = mockFetch({});
    const res = await refundChargeTool.run({ chargeId: 'ch_1', amount: 500 }, CTX);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('email tool', () => {
  it('is gated', () => {
    expect(sendEmailTool.autonomy).toBe('gated');
  });

  it('POSTs to Resend with a Bearer key and JSON body', async () => {
    const fetchFn = mockFetch({ body: { id: 'email_1' } });
    const res = await sendEmailTool.run(
      { to: 'user@example.com', subject: 'Hi', text: 'hello' },
      { ...CTX, persona: 'support' },
    );
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe('Bearer re_test_key');
    expect((init as any).headers['Content-Type']).toBe('application/json');
    const payload = JSON.parse((init as any).body);
    expect(payload.from).toBe('Sentinel <ops@bentech.dev>');
    expect(payload.to).toEqual(['user@example.com']);
    expect(payload.subject).toBe('Hi');
    expect(payload.text).toBe('hello');
  });

  it('missing RESEND_API → not_configured (no throw), no fetch', async () => {
    delete process.env.RESEND_API;
    const fetchFn = mockFetch({});
    const res = await sendEmailTool.run({ to: 'a@b.com', subject: 's', text: 't' }, CTX);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('github tools', () => {
  it('reads are auto, writes are gated', () => {
    expect(listWorkflowRunsTool.autonomy).toBe('auto');
    expect(triggerWorkflowTool.autonomy).toBe('gated');
    expect(commitFileTool.autonomy).toBe('gated');
  });

  it('triggerWorkflow POSTs a dispatch with ref + Bearer token', async () => {
    const fetchFn = mockFetch({ ok: true, status: 204, body: {} });
    const res = await triggerWorkflowTool.run(
      { repo: 'owner/repo', workflowId: 'deploy.yml', ref: 'main' },
      { ...CTX, persona: 'cto' },
    );
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/owner/repo/actions/workflows/deploy.yml/dispatches');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers.Authorization).toBe('Bearer ghp_test_token');
    expect(JSON.parse((init as any).body).ref).toBe('main');
  });

  it('commitFile PUTs base64-encoded content', async () => {
    const fetchFn = mockFetch({ body: { commit: { sha: 'abc123' }, content: { sha: 'blob1' } } });
    const res = await commitFileTool.run(
      { repo: 'owner/repo', path: 'config/roadmap.json', content: 'hello', message: 'update' },
      { ...CTX, persona: 'cto' },
    );
    expect(res.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/owner/repo/contents/config/roadmap.json');
    expect((init as any).method).toBe('PUT');
    const payload = JSON.parse((init as any).body);
    expect(payload.message).toBe('update');
    expect(Buffer.from(payload.content, 'base64').toString('utf8')).toBe('hello');
  });

  it('missing HERMES_GITHUB_TOKEN → not_configured (no throw), no fetch', async () => {
    delete process.env.HERMES_GITHUB_TOKEN;
    const fetchFn = mockFetch({});
    const res = await triggerWorkflowTool.run(
      { repo: 'owner/repo', workflowId: 'deploy.yml', ref: 'main' },
      { ...CTX, persona: 'cto' },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
