import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Agent Builder API route (app/api/v2/admin/agent-builder/route.ts).
//
// Proves the safety spine of the meta-feature WITHOUT a real DB/auth backend:
//   • every method is admin-gated (requireSectionApi('admin')),
//   • 'save' persists a DRAFT and AUDITS 'persona.drafted',
//   • 'approve' flips draft→approved, AUDITS 'persona.approved', and — critically —
//     does NOT register the persona into the LIVE registry (getPersona stays
//     undefined for the drafted id; the running persona set is untouched),
//   • 'generate' returns an advisory / read-only draft.
//
// auth + audit are mocked (spies); the store runs on its in-memory fallback
// (hasDb:false). getPersona is the REAL registry so the "not live" assertion is
// honest. server-only/@/lib/data are stubbed for the registry import chain.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const requireSectionApi = vi.fn(async (_s: string) => null); // null = permitted
  const getSessionAccess = vi.fn(async () => ({ userId: 'admin1', role: 'global_admin', sections: [] }));
  const appendAudit = vi.fn(async () => ({ rowHash: 'h', seq: 0 }) as any);
  return { requireSectionApi, getSessionAccess, appendAudit };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', () => ({
  getServiceTicket: vi.fn(),
  getTicketsByKind: vi.fn(),
  updateTicket: vi.fn(),
  addTicketComment: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  requireSectionApi: h.requireSectionApi,
  getSessionAccess: h.getSessionAccess,
}));
vi.mock('@/lib/hermes/audit', () => ({ appendAudit: h.appendAudit }));
vi.mock('@/lib/hermes/brain/flags', () => ({ brainEnabled: () => false }));
vi.mock('@/lib/hermes/openrouter', () => ({ chat: vi.fn() }));
vi.mock('@/lib/db', () => ({
  hasDb: false,
  q: vi.fn(async () => []),
  q1: vi.fn(async () => null),
}));

import { GET, POST } from '@/app/api/v2/admin/agent-builder/route';
import { _resetDraftStoreForTest } from '@/lib/agent-builder/store';
import { getPersona } from '@/lib/hermes/brain/personas';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/v2/admin/agent-builder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.requireSectionApi.mockClear();
  h.requireSectionApi.mockResolvedValue(null);
  h.getSessionAccess.mockClear();
  h.appendAudit.mockClear();
  _resetDraftStoreForTest();
});

describe('admin gate', () => {
  it('GET is gated on the admin section', async () => {
    await GET();
    expect(h.requireSectionApi).toHaveBeenCalledWith('admin');
  });

  it('POST refuses when the gate denies (returns the denial response)', async () => {
    const denial = new Response('forbidden', { status: 403 });
    h.requireSectionApi.mockResolvedValueOnce(denial as any);
    const res = await post({ action: 'save', draft: {} });
    expect(res.status).toBe(403);
  });
});

describe('generate action', () => {
  it('returns an advisory, read-only draft (no tools) with the Brain off', async () => {
    const res = await post({ action: 'generate', brief: 'a morning incident briefer', section: 'operations' });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.draft.allowedTools).toEqual([]);
    expect(body.draft.advisory).toBe(true);
    expect(body.usedModel).toBe(false);
  });

  it('rejects an empty brief', async () => {
    const res = await post({ action: 'generate', brief: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('save action', () => {
  it('persists a DRAFT and audits persona.drafted', async () => {
    const draft = {
      id: 'draft-briefer',
      label: 'Briefer',
      systemPrompt: '# SOUL — Briefer',
      allowedTools: ['getTicket', 'refundCharge'], // gated must be stripped on save
      section: 'operations',
    };
    const res = await post({ action: 'save', draft });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.draft.status).toBe('draft');
    expect(body.draft.allowedTools).toEqual(['getTicket']); // gated dropped
    const audited = h.appendAudit.mock.calls.map((c) => c[0].action);
    expect(audited).toContain('persona.drafted');
  });
});

describe('approve action — human gate, NOT activation', () => {
  async function seedDraft() {
    await post({
      action: 'save',
      draft: {
        id: 'draft-live-check',
        label: 'Live Check',
        systemPrompt: '# SOUL',
        allowedTools: ['getTicket'],
        section: 'security',
      },
    });
    h.appendAudit.mockClear();
  }

  it('flips draft→approved and audits persona.approved', async () => {
    await seedDraft();
    const res = await post({ action: 'approve', id: 'draft-live-check' });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.draft.status).toBe('approved');
    const call = h.appendAudit.mock.calls.find((c) => c[0].action === 'persona.approved');
    expect(call).toBeTruthy();
    // The audit detail records that the persona is explicitly NOT live.
    expect(call![0].detail).toMatchObject({ live: false });
  });

  it('does NOT register the approved persona into the LIVE registry', async () => {
    await seedDraft();
    // Before approval the id is not a live persona…
    expect(getPersona('draft-live-check')).toBeUndefined();
    await post({ action: 'approve', id: 'draft-live-check' });
    // …and it is STILL not a live persona after approval. Approval ≠ activation.
    expect(getPersona('draft-live-check')).toBeUndefined();
    // The real personas remain the only live ones.
    expect(getPersona('pa')).toBeDefined();
    expect(getPersona('cto')).toBeDefined();
  });

  it('404s approving a non-existent draft', async () => {
    const res = await post({ action: 'approve', id: 'ghost' });
    expect(res.status).toBe(404);
  });
});

describe('unknown action', () => {
  it('400s', async () => {
    const res = await post({ action: 'frobnicate' });
    expect(res.status).toBe(400);
  });
});
