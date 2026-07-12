import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hermes · KB Auto-Authoring — article draft + gated proposal.
//
//   • Brain OFF → draftArticle returns a deterministic SKELETON and NEVER calls
//     the model (the model module is mocked; its spy must stay untouched).
//   • Brain ON  → draftArticle uses the (mocked) model and returns an 'llm' article.
//   • The route's `propose` action persists a kind:'kb-article' proposal carrying
//     the drafted markdown and NEVER publishes to the KB (no content/kb write) —
//     it only calls saveProposal.
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

// Mocked model — draft.ts dynamically imports this only on the LLM path.
const h = vi.hoisted(() => ({
  callModel: vi.fn(),
}));
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: h.callModel }));

import { draftArticle } from '@/lib/kb-authoring/draft';

const gapInput = {
  theme: 'captions',
  suggestedTitle: 'Exporting captions to SRT',
  examples: [
    { ref: 'REQ-9', title: 'Exporting captions to SRT', question: 'how do I export captions to SRT', resolution: 'Open the transcript, choose Export → SRT.' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('draftArticle — brain OFF (deterministic skeleton)', () => {
  it('returns a skeleton and never calls the model', async () => {
    const article = await draftArticle(gapInput, { useLlm: false });
    expect(article.source).toBe('skeleton');
    expect(article.title).toBe('Exporting captions to SRT');
    expect(article.slug).toBe('exporting-captions-to-srt');
    // Grounded in the resolved ticket — the recorded resolution appears verbatim.
    expect(article.bodyMarkdown).toContain('Export → SRT');
    expect(article.bodyMarkdown).toContain('REQ-9');
    expect(h.callModel).not.toHaveBeenCalled();
  });

  it('is deterministic', async () => {
    const a = await draftArticle(gapInput, { useLlm: false });
    const b = await draftArticle(gapInput, { useLlm: false });
    expect(a).toEqual(b);
  });
});

describe('draftArticle — brain ON (LLM body)', () => {
  it('uses the model and returns an llm article', async () => {
    h.callModel.mockResolvedValue({
      ok: true,
      model: 'mock-model',
      content: JSON.stringify({
        title: 'How to export captions to SRT',
        summary: 'Steps to export captions as an SRT file.',
        body: '# Export captions\n\nOpen the transcript and choose Export → SRT.',
        category: 'Technical',
      }),
    });
    const article = await draftArticle(gapInput, { useLlm: true });
    expect(h.callModel).toHaveBeenCalledOnce();
    expect(article.source).toBe('llm');
    expect(article.model).toBe('mock-model');
    expect(article.title).toBe('How to export captions to SRT');
  });

  it('falls back to the skeleton if the model fails', async () => {
    h.callModel.mockResolvedValue({ ok: false, error: 'no key' });
    const article = await draftArticle(gapInput, { useLlm: true });
    expect(article.source).toBe('skeleton');
  });
});

// ---------------------------------------------------------------------------
// Route: propose → kb-article proposal, no publish.
// ---------------------------------------------------------------------------
const r = vi.hoisted(() => ({
  saveProposal: vi.fn(async () => 'prop-123'),
  getTicketsByKind: vi.fn(async () => ({ rows: [], live: false })),
  getTicketComments: vi.fn(async () => []),
}));

vi.mock('@/lib/auth', () => ({
  requireSectionApi: vi.fn(async () => null), // permitted
  getSessionAccess: vi.fn(async () => ({ userId: 'op-1', role: 'global_admin', sections: [] })),
}));
vi.mock('@/lib/data', () => ({
  getTicketsByKind: r.getTicketsByKind,
  getTicketComments: r.getTicketComments,
}));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: r.saveProposal }));
vi.mock('@/lib/hermes/brain/flags', () => ({ brainEnabled: () => false }));

import { POST } from '@/app/api/v2/admin/kb-authoring/route';

describe('POST propose — persists a kb-article proposal, never publishes', () => {
  it('calls saveProposal with kind kb-article and carries the markdown', async () => {
    const article = {
      title: 'Exporting captions to SRT',
      summary: 'How to export captions.',
      bodyMarkdown: '# Exporting captions to SRT\n\nOpen the transcript…',
      slug: 'exporting-captions-to-srt',
      category: 'Technical',
      source: 'skeleton',
    };
    const req = new Request('http://localhost/api/v2/admin/kb-authoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'propose', article, exampleRefs: ['REQ-9'] }),
    });
    const res = await POST(req);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.proposalId).toBe('prop-123');
    expect(r.saveProposal).toHaveBeenCalledOnce();
    const arg = r.saveProposal.mock.calls[0][0] as any;
    expect(arg.kind).toBe('kb-article');
    expect(arg.ref).toBe(''); // not tied to a ticket → approve can't post a comment
    expect(arg.proposal.draft).toContain('Exporting captions to SRT');
    expect(arg.proposal.sources).toContain('REQ-9');
  });
});
