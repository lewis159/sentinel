import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Intake visibility mapping — the public support-chat route must write the
// customer-visible comments (the customer's own message + the AI reply that is
// shown back to them) as visibility='external', while internal AI drafts stay
// 'internal'. This is what makes a future customer-facing read safe.
//
// We mock @/lib/data so no DB is touched and addTicketComment is a spy we can
// assert the visibility arg on; auth is the REAL verifySupportIntake driven by
// a configured token, and the copilot is stubbed to a confident answer so the
// happy "answered" path (kind:'ai-reply', external) runs.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  createTicket: vi.fn(async () => ({ ref: 'REQ-9001' })),
  getServiceTicket: vi.fn(async () => ({ row: null })),
  addTicketComment: vi.fn(async () => ({ id: 'c1' })),
  updateTicket: vi.fn(async () => ({})),
  runCopilotProposal: vi.fn(async () => ({ ok: true, draft: 'Here is your answer.', confidence: 90, priority: 'medium' })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', () => ({
  createTicket: h.createTicket,
  getServiceTicket: h.getServiceTicket,
  addTicketComment: h.addTicketComment,
  updateTicket: h.updateTicket,
}));
vi.mock('@/lib/hermes/brain/copilot', () => ({ runCopilotProposal: h.runCopilotProposal }));

import { POST } from '@/app/api/public/support/chat/route';
import { __resetRateLimitStore } from '@/lib/rate-limit';

const TOKEN = 'test-support-token';

function req(body: unknown) {
  return new Request('http://localhost/api/public/support/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-token': TOKEN },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// All calls addTicketComment received, as [ref, body, author, kind, visibility].
const calls = () => h.addTicketComment.mock.calls as any[][];
const callFor = (kind: string) => calls().find((c) => c[3] === kind);

beforeEach(() => {
  __resetRateLimitStore();
  Object.values(h).forEach((fn) => fn.mockClear());
  h.createTicket.mockResolvedValue({ ref: 'REQ-9001' } as any);
  h.getServiceTicket.mockResolvedValue({ row: null } as any);
  h.runCopilotProposal.mockResolvedValue({ ok: true, draft: 'Here is your answer.', confidence: 90, priority: 'medium' } as any);
  process.env.OPS_SUPPORT_TOKEN = TOKEN;
  delete process.env.OPS_INGEST_SECRET;
  process.env.HERMES_INTAKE_ENABLED = '1';
});

describe('support-chat intake visibility', () => {
  it("writes the customer's own message as external", async () => {
    const res = await POST(req({ message: 'my captions are wrong' }));
    expect(res.status).toBe(200);
    const customer = callFor('customer');
    expect(customer).toBeTruthy();
    expect(customer![4]).toBe('external'); // visibility arg
  });

  it('writes the answered AI reply (shown to the customer) as external', async () => {
    const res = await POST(req({ message: 'how do I export?' }));
    expect(res.status).toBe(200);
    const reply = callFor('ai-reply');
    expect(reply).toBeTruthy();
    expect(reply![4]).toBe('external');
  });

  it('keeps a low-confidence AI DRAFT internal (never shown to the customer)', async () => {
    // Low confidence → the draft is stored as kind:'ai-draft' and a separate
    // holding 'ai-reply' is what the customer actually sees.
    h.runCopilotProposal.mockResolvedValueOnce({ ok: true, draft: 'unsure draft', confidence: 10 } as any);
    const res = await POST(req({ message: 'obscure question' }));
    expect(res.status).toBe(200);

    const draft = callFor('ai-draft');
    expect(draft).toBeTruthy();
    expect(draft![4]).toBe('internal'); // the internal draft stays hidden

    const reply = callFor('ai-reply');
    expect(reply).toBeTruthy();
    expect(reply![4]).toBe('external'); // the holding message the customer sees
  });
});
