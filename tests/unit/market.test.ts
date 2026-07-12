import { describe, it, expect, vi, beforeEach } from 'vitest';

// Market & Content pipeline — config listing, deterministic (brain-off) skeletons
// with NO model call, and scan/draft producing the right proposal KIND with no
// publish (empty ref + no executable action). DB/model/KB are mocked.

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => {
  const saveProposal = vi.fn(async () => 'prop-123');
  const callModel = vi.fn(async () => ({
    ok: true,
    content: 'MODEL BODY',
    toolCalls: [],
    model: 'mock-model',
  }));
  const retrieveKb = vi.fn(async () => [
    { slug: 'rate-limiting', title: 'Rate limits', body: 'runbook body' },
  ]);
  return { saveProposal, callModel, retrieveKb };
});

vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: h.saveProposal }));
vi.mock('@/lib/hermes/brain/model', () => ({ callModel: h.callModel }));
vi.mock('@/lib/hermes/kb-context', () => ({ retrieveKb: h.retrieveKb }));

import {
  listCompetitors,
  getCompetitor,
  listKeywords,
  isContentType,
} from '@/lib/market/config';
import { buildContentSkeleton, draftContent } from '@/lib/market/content';
import { scanCompetitor } from '@/lib/market/competitors';

beforeEach(() => {
  h.saveProposal.mockClear();
  h.callModel.mockClear();
  h.retrieveKb.mockClear();
  delete process.env.HERMES_BRAIN_ENABLED; // brain OFF by default
});

describe('market config listing', () => {
  it('lists competitors and looks them up case-insensitively', () => {
    expect(listCompetitors().length).toBeGreaterThanOrEqual(3);
    expect(getCompetitor('otter-ai')?.name).toBe('Otter.ai');
    expect(getCompetitor('OTTER-AI')?.name).toBe('Otter.ai');
    expect(getCompetitor('does-not-exist')).toBeNull();
  });

  it('lists SEO target keywords and validates content types', () => {
    expect(listKeywords()).toContain('ai meeting notes');
    expect(isContentType('blog')).toBe(true);
    expect(isContentType('podcast')).toBe(false);
  });

  it('returns copies (mutating the result cannot corrupt the seed)', () => {
    const a = listCompetitors();
    a[0].name = 'HACKED';
    expect(getCompetitor(a[0].slug)?.name).not.toBe('HACKED');
  });
});

describe('content skeleton (pure)', () => {
  it('produces a title, outline and meta description for each type', () => {
    for (const type of ['blog', 'help', 'landing'] as const) {
      const sk = buildContentSkeleton('add subtitles to video', type);
      expect(sk.type).toBe(type);
      expect(sk.title.length).toBeGreaterThan(0);
      expect(sk.outline.length).toBeGreaterThanOrEqual(4);
      expect(sk.metaDescription.length).toBeGreaterThan(20);
      expect(sk.metaDescription.length).toBeLessThanOrEqual(159);
    }
  });

  it('throws on empty keyword or bad type', () => {
    expect(() => buildContentSkeleton('', 'blog')).toThrow();
    // @ts-expect-error — bad type on purpose
    expect(() => buildContentSkeleton('x', 'video')).toThrow();
  });
});

describe('draftContent — brain OFF is deterministic (no model)', () => {
  it('returns a skeleton-only draft, calls no model, persists nothing without commit', async () => {
    const res = await draftContent({ keyword: 'convert video to text', type: 'blog' });
    expect(res.ok).toBe(true);
    expect(res.draft?.body).toBeNull();
    expect(res.draft?.bodySource).toBe('skeleton');
    expect(res.draft?.outline.length).toBeGreaterThan(0);
    expect(h.callModel).not.toHaveBeenCalled();
    expect(res.proposalId).toBeNull();
    expect(h.saveProposal).not.toHaveBeenCalled();
  });

  it('commit=true queues a content-draft proposal with NO publish target/action', async () => {
    const res = await draftContent({ keyword: 'ai meeting notes', type: 'help', commit: true });
    expect(res.ok).toBe(true);
    expect(h.callModel).not.toHaveBeenCalled(); // still brain-off
    expect(h.saveProposal).toHaveBeenCalledTimes(1);
    const arg = h.saveProposal.mock.calls[0][0] as any;
    expect(arg.kind).toBe('content-draft');
    expect(arg.ref).toBe(''); // empty ref → approval can never post to a ticket
    expect(arg.proposal.action).toBeUndefined(); // never an executable action
    expect(res.proposalId).toBe('prop-123');
  });
});

describe('draftContent — brain ON uses the model, help grounds in KB', () => {
  it('fills the body from the model and grounds help articles in the KB', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const res = await draftContent({ keyword: 'srt caption generator', type: 'help' });
    expect(h.callModel).toHaveBeenCalledTimes(1);
    expect(h.retrieveKb).toHaveBeenCalled(); // help type → KB grounding
    expect(res.draft?.body).toBe('MODEL BODY');
    expect(res.draft?.bodySource).toBe('model');
    expect(res.draft?.grounded).toContain('rate-limiting');
  });

  it('does NOT ground a blog draft in the KB', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    await draftContent({ keyword: 'podcast transcription software', type: 'blog' });
    expect(h.retrieveKb).not.toHaveBeenCalled();
  });
});

describe('scanCompetitor — draft brief, no live web, right kind', () => {
  it('brain OFF returns a deterministic notes-based brief with no model call', async () => {
    const res = await scanCompetitor({ slug: 'otter-ai', commit: true });
    expect(res.ok).toBe(true);
    expect(res.brief?.analysisSource).toBe('notes');
    expect(res.brief?.disclaimer.toLowerCase()).toContain('not live web data');
    expect(h.callModel).not.toHaveBeenCalled();
  });

  it('commit=true queues a competitor-brief proposal with NO publish target/action', async () => {
    await scanCompetitor({ slug: 'otter-ai', commit: true });
    expect(h.saveProposal).toHaveBeenCalledTimes(1);
    const arg = h.saveProposal.mock.calls[0][0] as any;
    expect(arg.kind).toBe('competitor-brief');
    expect(arg.ref).toBe('');
    expect(arg.proposal.action).toBeUndefined();
  });

  it('brain ON authors the analysis via the model', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const res = await scanCompetitor({ slug: 'rev' });
    expect(h.callModel).toHaveBeenCalledTimes(1);
    expect(res.brief?.analysisSource).toBe('model');
    expect(res.brief?.analysis).toContain('MODEL BODY');
  });

  it('rejects an unknown competitor without persisting anything', async () => {
    const res = await scanCompetitor({ slug: 'nope', commit: true });
    expect(res.ok).toBe(false);
    expect(h.saveProposal).not.toHaveBeenCalled();
  });
});
