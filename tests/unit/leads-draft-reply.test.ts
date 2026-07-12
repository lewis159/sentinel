import { describe, it, expect, vi, beforeEach } from 'vitest';

// Admin draft-reply route — proves a pre-sale reply is DRAFTED and persisted as a
// proposal (kind 'lead-reply') for the approval queue, and NOTHING is sent. All
// I/O (auth, DB, KB/model draft, proposal store) is mocked.

const h = vi.hoisted(() => ({
  requireSectionApi: vi.fn(async () => null), // allowed
  getServiceTicket: vi.fn(async (ref: string) => ({
    row: {
      ref,
      title: 'Lead · Acme',
      description: 'Do you support SSO on the Business plan?',
      status: 'new',
      customerName: 'Dana',
      customerEmail: 'dana@acme.io',
      attrs: { lead: true, lead_company: 'Acme', lead_question: 'Do you support SSO on the Business plan?' },
    },
    live: false,
  })),
  draftPresaleReply: vi.fn(async () => ({
    draft: 'Hi Dana, yes — SSO/SAML is available on Business. A team member can help set it up.',
    sources: [{ slug: 'sso-setup', title: 'Setting up SSO / SAML', body: '...' }],
    grounded: true,
    model: 'mock-model',
  })),
  saveProposal: vi.fn(async () => 'prop-123'),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireSectionApi: h.requireSectionApi }));
vi.mock('@/lib/data', () => ({
  getServiceTicket: h.getServiceTicket,
  getTicketsByKind: vi.fn(async () => ({ rows: [], live: false })),
  createTicket: vi.fn(async () => ({ ref: 'REQ-0001' })),
}));
vi.mock('@/lib/leads/refine', () => ({ draftPresaleReply: h.draftPresaleReply }));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: h.saveProposal }));

import { POST } from '@/app/api/v2/admin/leads/route';

function req(body: unknown) {
  return new Request('http://localhost/api/v2/admin/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  Object.values(h).forEach((fn: any) => fn.mockClear?.());
  h.requireSectionApi.mockResolvedValue(null);
});

describe('POST /api/v2/admin/leads — draft reply (gated, no send)', () => {
  it('drafts a grounded reply and persists it as a lead-reply proposal', async () => {
    const res = await POST(req({ ref: 'REQ-0007' }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.grounded).toBe(true);
    expect(body.proposalId).toBe('prop-123');
    expect(body.draft).toMatch(/SSO/);

    // A proposal was saved with the lead-reply kind carrying the DRAFT — and no
    // send/email path exists in this route, so nothing was dispatched.
    expect(h.saveProposal).toHaveBeenCalledTimes(1);
    const saved = h.saveProposal.mock.calls[0][0];
    expect(saved.kind).toBe('lead-reply');
    expect(saved.ref).toBe('REQ-0007');
    expect(saved.proposal.draft).toMatch(/SSO/);
    // Draft-only proposal: no gated ACTION spine attached (never auto-executes).
    expect(saved.proposal.action).toBeUndefined();
  });

  it('403s (does not draft) when the section gate denies', async () => {
    const { NextResponse } = await import('next/server');
    h.requireSectionApi.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await POST(req({ ref: 'REQ-0007' }));
    expect(res.status).toBe(403);
    expect(h.draftPresaleReply).not.toHaveBeenCalled();
    expect(h.saveProposal).not.toHaveBeenCalled();
  });

  it('404s when the ref is not a lead', async () => {
    h.getServiceTicket.mockResolvedValueOnce({
      row: { ref: 'REQ-9', title: 't', description: 'd', status: 'new', attrs: {} },
      live: false,
    } as any);
    const res = await POST(req({ ref: 'REQ-9' }));
    expect(res.status).toBe(404);
    expect(h.saveProposal).not.toHaveBeenCalled();
  });
});
