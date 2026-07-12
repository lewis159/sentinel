import { describe, it, expect, vi, beforeEach } from 'vitest';

// Internal Knowledge Q&A — the grounded answerer (lib/hermes/brain/knowledge.ts).
//
// Proves the contract WITHOUT any real network/DB:
//   • Brain OFF → returns { status:'disabled' } and NEVER retrieves or calls the
//     model (dormant-safe).
//   • Brain ON  → retrieves KB (via the existing retriever, called with the
//     question) + resolved tickets + roadmap; the model prompt INCLUDES that
//     retrieved context; and the returned sources are ONLY the retrieved items the
//     model cited — a fabricated citation is dropped.
//
// We mock the model, KB retriever, and data reads, mirroring the existing unit
// tests (copilot-action.test.ts). No real embeddings/DB/OpenRouter is touched.

const h = vi.hoisted(() => {
  const callModel = vi.fn(async () => ({
    ok: true as const,
    // Cites 3 REAL retrieved refs + 1 fabricated one (must be dropped).
    content: JSON.stringify({
      answer: 'Requeue the worker by resetting status to queued.',
      sources: ['recover-stalled-worker', 'INC-0002', 'RM-004', 'totally-made-up'],
    }),
    toolCalls: [],
    model: 'mock-model',
  }));
  const retrieveKb = vi.fn(async () => [
    {
      slug: 'recover-stalled-worker',
      title: 'Recovering a stalled worker',
      body: 'Requeue by resetting status to queued and clearing leased_at.',
    },
  ]);
  const getRecentTickets = vi.fn(async () => ({
    rows: [
      { ref: 'INC-0002', title: 'Stalled worker recovery', description: 'worker heartbeat lost', status: 'resolved' },
      { ref: 'INC-9999', title: 'Unrelated billing query', description: 'refund', status: 'open' }, // not resolved → filtered out
    ],
    live: false,
  }));
  const getRoadmap = vi.fn(async () => ({
    rows: [
      { itemKey: 'RM-004', title: 'Self-hosted HA Postgres cutover', description: 'Patroni HA', status: 'in_review', app: 'Sentinel' },
      { itemKey: 'RM-050', title: 'Marketing site refresh', description: 'copy', status: 'backlog', app: 'Estate' },
    ],
    live: false,
  }));
  return { callModel, retrieveKb, getRecentTickets, getRoadmap };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: h.callModel }));
vi.mock('@/lib/hermes/kb-context', () => ({ retrieveKb: h.retrieveKb }));
vi.mock('@/lib/data', () => ({
  getRecentTickets: h.getRecentTickets,
  getRoadmap: h.getRoadmap,
}));

import { answerKnowledgeQuestion } from '@/lib/hermes/brain/knowledge';

const QUESTION = 'How do we recover a stalled transcription worker and what is the postgres HA plan?';

beforeEach(() => {
  h.callModel.mockClear();
  h.retrieveKb.mockClear();
  h.getRecentTickets.mockClear();
  h.getRoadmap.mockClear();
});

describe('answerKnowledgeQuestion — brain OFF', () => {
  beforeEach(() => {
    delete process.env.HERMES_BRAIN_ENABLED;
  });

  it('returns a disabled result and never retrieves or calls the model', async () => {
    const res = await answerKnowledgeQuestion(QUESTION);
    expect(res.status).toBe('disabled');
    expect(res.answer).toMatch(/disabled/i);
    expect(res.sources).toEqual([]);
    // Dormant-safe: nothing was retrieved and the model was never hit.
    expect(h.retrieveKb).not.toHaveBeenCalled();
    expect(h.getRecentTickets).not.toHaveBeenCalled();
    expect(h.getRoadmap).not.toHaveBeenCalled();
    expect(h.callModel).not.toHaveBeenCalled();
  });
});

describe('answerKnowledgeQuestion — brain ON', () => {
  beforeEach(() => {
    process.env.HERMES_BRAIN_ENABLED = '1';
  });

  it('retrieves KB with the question, grounds the prompt in retrieved context, and returns answer + only-cited sources', async () => {
    const res = await answerKnowledgeQuestion(QUESTION);

    // The KB retriever was called WITH the question.
    expect(h.retrieveKb).toHaveBeenCalledTimes(1);
    expect(h.retrieveKb.mock.calls[0][0]).toBe(QUESTION);
    // Tickets + roadmap were also retrieved for grounding.
    expect(h.getRecentTickets).toHaveBeenCalledTimes(1);
    expect(h.getRoadmap).toHaveBeenCalledTimes(1);

    // The model was called exactly once, and its prompt INCLUDES the retrieved
    // context. We assert on the CONTEXT block's bracketed markers ([kb:…],
    // [ticket:…], [roadmap:…]) which only appear in the grounding block — the
    // persona system prompt merely mentions example refs, so a whole-prompt
    // contains-check would be polluted by it.
    expect(h.callModel).toHaveBeenCalledTimes(1);
    const messages = h.callModel.mock.calls[0][0].messages as { content: string }[];
    const context = messages.find((m) => m.content.includes('ESTATE CONTEXT'))!.content;
    expect(context).toContain('[kb:recover-stalled-worker]');
    expect(context).toContain('Requeue by resetting status to queued'); // KB body
    expect(context).toContain('[ticket:INC-0002]'); // resolved ticket ref
    expect(context).toContain('Stalled worker recovery'); // ticket title
    expect(context).toContain('[roadmap:RM-004]'); // roadmap key
    expect(context).toContain('Postgres'); // roadmap title
    // The user question is carried as its own message.
    expect(messages.some((m) => m.content === QUESTION)).toBe(true);

    // Answer flows through.
    expect(res.status).toBe('answered');
    expect(res.answer).toContain('Requeue');
    if (res.status === 'answered') expect(res.model).toBe('mock-model');

    // Sources are ONLY the retrieved items the model cited — the fabricated
    // 'totally-made-up' citation is dropped; the unresolved/unrelated rows never
    // made it into the grounding set.
    const refs = res.sources.map((s) => s.ref).sort();
    expect(refs).toEqual(['INC-0002', 'RM-004', 'recover-stalled-worker']);
    const byType = Object.fromEntries(res.sources.map((s) => [s.ref, s.type]));
    expect(byType['recover-stalled-worker']).toBe('kb');
    expect(byType['INC-0002']).toBe('ticket');
    expect(byType['RM-004']).toBe('roadmap');
    // Every source resolves to a real console href.
    for (const s of res.sources) expect(typeof s.href).toBe('string');
    // No fabricated source leaked through.
    expect(res.sources.find((s) => s.ref === 'totally-made-up')).toBeUndefined();
  });

  it('drops a resolved ticket that does not overlap the question', async () => {
    // A question with no overlap to any resolved ticket/roadmap item → those
    // grounding sets are empty even though the reads returned rows.
    await answerKnowledgeQuestion('What are the office opening hours?');
    const messages = h.callModel.mock.calls[0][0].messages as { content: string }[];
    const context = messages.find((m) => m.content.includes('ESTATE CONTEXT'))!.content;
    // The grounding block excludes the non-overlapping ticket/roadmap rows.
    expect(context).not.toContain('[ticket:INC-0002]');
    expect(context).not.toContain('[roadmap:RM-004]');
  });
});
