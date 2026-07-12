import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Agent Builder — brief→draft generation (lib/agent-builder/generate.ts) and the
// draft store (lib/agent-builder/store.ts).
//
// Proves the safety-critical generation contract against the REAL tool registry:
//   • deterministic skeleton, read-only default, NO model call when the Brain is
//     off (same brief → identical draft, empty tool set),
//   • when the Brain is on, the model's suggested tools are hard-filtered to
//     EXISTING, read-only registry tools — invented + gated + side-effecting tools
//     are dropped,
//   • the store's CRUD + status transitions (draft → approved) behave, and approval
//     records who/when.
//
// The registry imports 'server-only' + '@/lib/data'; stub them so we can use the
// REAL tools without a DB/server runtime. brainEnabled + chat are mocked so we
// drive both the off (skeleton) and on (enriched) paths deterministically.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const state = { brainOn: false };
  const chat = vi.fn(async (_opts: any) => ({ ok: false, error: 'not configured' }) as any);
  return { state, chat };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', () => ({
  getServiceTicket: vi.fn(),
  getTicketsByKind: vi.fn(),
  updateTicket: vi.fn(),
  addTicketComment: vi.fn(),
}));
vi.mock('@/lib/hermes/brain/flags', () => ({ brainEnabled: () => h.state.brainOn }));
vi.mock('@/lib/hermes/openrouter', () => ({ chat: h.chat }));
// No DATABASE_URL → the store uses its in-memory fallback (mock-safe path).
vi.mock('@/lib/db', () => ({
  hasDb: false,
  q: vi.fn(async () => []),
  q1: vi.fn(async () => null),
}));

import { generateDraft, sanitizeTools, readOnlySafeToolNames } from '@/lib/agent-builder/generate';
import {
  saveDraft,
  getDraft,
  listDrafts,
  setStatus,
  _resetDraftStoreForTest,
} from '@/lib/agent-builder/store';

beforeEach(() => {
  h.state.brainOn = false;
  h.chat.mockClear();
  h.chat.mockResolvedValue({ ok: false, error: 'not configured' });
  _resetDraftStoreForTest();
});

describe('generateDraft — deterministic skeleton (Brain off)', () => {
  const brief = 'An agent that reviews open incidents each morning and flags risk.';

  it('produces a stable id/label, read-only (empty) tool set, and no model call', async () => {
    const res = await generateDraft({ brief, section: 'operations' });
    expect(res.usedModel).toBe(false);
    expect(h.chat).not.toHaveBeenCalled();
    expect(res.draft.id).toMatch(/^draft-/);
    expect(res.draft.label.length).toBeGreaterThan(0);
    expect(res.draft.allowedTools).toEqual([]); // advisory / read-only by default
    expect(res.draft.autonomy).toEqual({}); // no gated overrides on a fresh draft
    expect(res.draft.section).toBe('operations');
    expect(res.draft.systemPrompt).toMatch(/DRAFT/);
    expect(res.draft.systemPrompt).toMatch(/[Aa]dvisory/);
  });

  it('is deterministic — same brief yields an identical draft', async () => {
    const a = await generateDraft({ brief, section: 'operations' });
    const b = await generateDraft({ brief, section: 'operations' });
    expect(a.draft).toEqual(b.draft);
  });

  it('defaults an unknown section to operations', async () => {
    const res = await generateDraft({ brief, section: 'not-a-section' });
    expect(res.draft.section).toBe('operations');
  });
});

describe('generateDraft — model enrichment (Brain on)', () => {
  it('filters the model tool suggestions to EXISTING read-only registry tools', async () => {
    h.state.brainOn = true;
    // Model suggests: two valid read-only tools, one invented, one GATED
    // (refundCharge), one auto-but-side-effecting (broadcastStatus). Only the two
    // pure reads must survive.
    h.chat.mockResolvedValue({
      ok: true,
      content: JSON.stringify({
        soul: '# SOUL — enriched\nA model-authored advisory prompt.',
        tools: ['getTicket', 'listTickets', 'deleteEverything', 'refundCharge', 'broadcastStatus'],
      }),
    });

    const res = await generateDraft({ brief: 'incident morning briefer', section: 'operations' });
    expect(res.usedModel).toBe(true);
    expect(h.chat).toHaveBeenCalledTimes(1);
    expect(res.draft.allowedTools).toEqual(['getTicket', 'listTickets']);
    expect(res.draft.allowedTools).not.toContain('deleteEverything'); // invented dropped
    expect(res.draft.allowedTools).not.toContain('refundCharge'); // gated dropped
    expect(res.draft.allowedTools).not.toContain('broadcastStatus'); // side-effecting dropped
    expect(res.draft.systemPrompt).toMatch(/enriched/);
    expect(res.draft.autonomy).toEqual({}); // still no gated overrides
  });

  it('falls back to the deterministic skeleton when the model errors', async () => {
    h.state.brainOn = true;
    h.chat.mockResolvedValue({ ok: false, error: 'OpenRouter 500' });
    const res = await generateDraft({ brief: 'x', section: 'support' });
    expect(res.usedModel).toBe(false);
    expect(res.modelError).toMatch(/500/);
    expect(res.draft.allowedTools).toEqual([]);
  });

  it('drops model output that is not parseable JSON', async () => {
    h.state.brainOn = true;
    h.chat.mockResolvedValue({ ok: true, content: 'sorry, I cannot do that' });
    const res = await generateDraft({ brief: 'x', section: 'support' });
    expect(res.usedModel).toBe(false);
    expect(res.draft.allowedTools).toEqual([]);
  });
});

describe('sanitizeTools / readOnlySafeToolNames', () => {
  it('the safe set contains pure reads and NONE of the gated/side-effecting tools', () => {
    const safe = readOnlySafeToolNames();
    expect(safe).toContain('getTicket');
    expect(safe).toContain('listTickets');
    expect(safe).not.toContain('updateTicket'); // gated
    expect(safe).not.toContain('refundCharge'); // gated
    expect(safe).not.toContain('commitFile'); // gated
    expect(safe).not.toContain('broadcastStatus'); // auto but side-effecting
  });

  it('drops invented and non-string entries', () => {
    expect(sanitizeTools(['getTicket', 'nope', 42, null, 'getTicket'])).toEqual(['getTicket']);
    expect(sanitizeTools('not-an-array')).toEqual([]);
  });
});

describe('draft store — CRUD + status transitions (in-memory / mock-safe)', () => {
  const def = {
    id: 'draft-test-agent',
    label: 'Test Agent',
    systemPrompt: '# SOUL — Test',
    allowedTools: ['getTicket'],
    section: 'operations' as const,
    autonomy: {},
  };

  it('saves as status="draft" and reads back', async () => {
    const saved = await saveDraft(def, 'web:u1');
    expect(saved.status).toBe('draft');
    expect(saved.createdBy).toBe('web:u1');
    expect(saved.approvedBy).toBeNull();

    const got = await getDraft('draft-test-agent');
    expect(got).not.toBeNull();
    expect(got!.label).toBe('Test Agent');
    expect(got!.allowedTools).toEqual(['getTicket']);
    expect(got!.status).toBe('draft');
  });

  it('lists drafts newest-first', async () => {
    await saveDraft({ ...def, id: 'draft-a' }, 'web:u1');
    await saveDraft({ ...def, id: 'draft-b' }, 'web:u1');
    const list = await listDrafts();
    const ids = list.map((d) => d.id);
    expect(ids).toContain('draft-a');
    expect(ids).toContain('draft-b');
  });

  it('setStatus("approved") records approver + timestamp; getDraft reflects it', async () => {
    await saveDraft(def, 'web:u1');
    const approved = await setStatus('draft-test-agent', 'approved', 'web:admin');
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe('approved');
    expect(approved!.approvedBy).toBe('web:admin');
    expect(approved!.approvedAt).toBeTruthy();

    const got = await getDraft('draft-test-agent');
    expect(got!.status).toBe('approved');
  });

  it('setStatus on a missing draft returns null', async () => {
    expect(await setStatus('nope', 'approved', 'web:admin')).toBeNull();
  });

  it('re-saving the same id keeps status="draft" (a save is never activation)', async () => {
    await saveDraft(def, 'web:u1');
    await setStatus('draft-test-agent', 'approved', 'web:admin');
    const resaved = await saveDraft({ ...def, label: 'Edited' }, 'web:u1');
    expect(resaved.status).toBe('draft');
    expect(resaved.label).toBe('Edited');
    expect(resaved.approvedBy).toBeNull();
  });
});
