import { describe, it, expect, vi, beforeEach } from 'vitest';

// Internal Knowledge Q&A — the ask route (app/api/v2/admin/knowledge/ask).
//
// Proves the flag + gate contract WITHOUT the model:
//   • Brain OFF → 200 { status:'disabled' } and answerKnowledgeQuestion is NEVER
//     called (so no retrieval, no model call) — the route is dormant-safe.
//   • Brain ON  → delegates to answerKnowledgeQuestion(question) and returns its
//     result verbatim.
//
// We mock the auth gate (so no Clerk) and the knowledge lib (so no model/DB), and
// toggle the flag via env — mirroring inngest-route.test.ts (dynamic import per
// case so env + mocks are picked up fresh).

const h = vi.hoisted(() => {
  const answerKnowledgeQuestion = vi.fn(async () => ({
    status: 'answered' as const,
    answer: 'Grounded answer.',
    sources: [{ type: 'kb' as const, ref: 'recover-stalled-worker', title: 'Recovering a stalled worker', href: '/v2/kb/recover-stalled-worker' }],
    model: 'mock-model',
  }));
  return { answerKnowledgeQuestion };
});

vi.mock('server-only', () => ({}));
// Gate always permits in these tests; identity is a fixed staff user.
vi.mock('@/lib/auth', () => ({
  requireSectionApi: vi.fn(async () => null),
  getSessionAccess: vi.fn(async () => ({ userId: 'staff-1', role: 'global_admin' })),
}));
vi.mock('@/lib/hermes/brain/knowledge', () => ({
  answerKnowledgeQuestion: h.answerKnowledgeQuestion,
  BRAIN_DISABLED_MESSAGE: 'Hermes Brain is disabled — set HERMES_BRAIN_ENABLED and a model key to enable Knowledge Q&A.',
}));

function post(body: unknown) {
  return new Request('http://localhost/api/v2/admin/knowledge/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  h.answerKnowledgeQuestion.mockClear();
});

describe('POST /api/v2/admin/knowledge/ask', () => {
  it('brain OFF → returns the disabled message and NEVER calls the answerer (no model call)', async () => {
    delete process.env.HERMES_BRAIN_ENABLED;
    const route = await import('@/app/api/v2/admin/knowledge/ask/route');
    const res = await route.POST(post({ question: 'anything' }));
    const json = await res.json();

    expect(json.status).toBe('disabled');
    expect(json.answer).toMatch(/disabled/i);
    expect(json.sources).toEqual([]);
    // Short-circuited before any retrieval/model work.
    expect(h.answerKnowledgeQuestion).not.toHaveBeenCalled();
  });

  it('brain ON → delegates to answerKnowledgeQuestion with the question and returns its result', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const route = await import('@/app/api/v2/admin/knowledge/ask/route');
    const res = await route.POST(post({ question: 'How do we recover a stalled worker?' }));
    const json = await res.json();

    expect(h.answerKnowledgeQuestion).toHaveBeenCalledTimes(1);
    expect(h.answerKnowledgeQuestion.mock.calls[0][0]).toBe('How do we recover a stalled worker?');
    expect(json.status).toBe('answered');
    expect(json.answer).toBe('Grounded answer.');
    expect(json.sources).toHaveLength(1);
    expect(json.sources[0].ref).toBe('recover-stalled-worker');
    expect(json.model).toBe('mock-model');
  });

  it('brain ON + empty question → 200 error, answerer not called', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const route = await import('@/app/api/v2/admin/knowledge/ask/route');
    const res = await route.POST(post({ question: '   ' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe('error');
    expect(h.answerKnowledgeQuestion).not.toHaveBeenCalled();
  });
});
