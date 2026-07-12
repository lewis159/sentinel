import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Exec on-demand invoke route (app/api/hermes/exec/chat/route.ts).
//
// Proves the route contract WITHOUT a real Brain / DB / auth backend:
//   • it ACCEPTS the three exec personas (ceo / cto / risk) and routes them
//     through runPaTurn({ persona, ... }) — the shared spine,
//   • it REJECTS a non-exec persona (a copilot id or garbage) up front, before
//     any section lookup or Brain work,
//   • a CTO gated interrupt is persisted as an action PROPOSAL (→ ApprovalsQueue),
//     i.e. the CTO reaches the approval queue exactly like the PA/copilots, and
//   • an advisory-only exec (Risk) can NEVER produce a gated action: even if the
//     graph somehow returned a pending interrupt, the route refuses to raise a
//     proposal (defensive assertion of the advisory contract).
//
// We mock auth + the Brain graph + the proposal store + the persona registry so
// importing the route never pulls in server-only / DB / model code.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const requireSectionApi = vi.fn(async (_section: string) => null); // null = permitted
  const getSessionAccess = vi.fn(async () => ({ userId: 'u_1', role: 'global_admin', sections: [] }));
  const runPaTurn = vi.fn(async (_opts: any) => ({ status: 'answered', reply: 'ok' }) as any);
  const saveActionProposal = vi.fn(async () => 'prop_123');
  const getPersona = vi.fn((id: string) => ({ id, advisory: id === 'risk' }) as any);
  return { requireSectionApi, getSessionAccess, runPaTurn, saveActionProposal, getPersona };
});

vi.mock('@/lib/auth', () => ({
  requireSectionApi: h.requireSectionApi,
  getSessionAccess: h.getSessionAccess,
}));
vi.mock('@/lib/hermes/brain/flags', () => ({ brainEnabled: () => true }));
vi.mock('@/lib/hermes/brain/graph', () => ({ runPaTurn: h.runPaTurn }));
vi.mock('@/lib/hermes/brain/personas', () => ({ getPersona: h.getPersona }));
vi.mock('@/lib/hermes/proposals', () => ({ saveActionProposal: h.saveActionProposal }));

import { POST } from '@/app/api/hermes/exec/chat/route';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/hermes/exec/chat', {
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
  h.runPaTurn.mockClear();
  h.runPaTurn.mockResolvedValue({ status: 'answered', reply: 'ok' });
  h.saveActionProposal.mockClear();
  h.getPersona.mockClear();
});

describe('exec invoke route — persona validation', () => {
  for (const persona of ['ceo', 'cto', 'risk'] as const) {
    it(`accepts the exec persona "${persona}" and runs a Brain turn`, async () => {
      const res = await post({ persona, threadId: 'web:1', message: 'status?' });
      const body = await res.json();
      expect(body.status).toBe('answered');
      expect(h.requireSectionApi).toHaveBeenCalledTimes(1);
      expect(h.runPaTurn).toHaveBeenCalledTimes(1);
      expect(h.runPaTurn.mock.calls[0][0]).toMatchObject({ persona });
    });
  }

  for (const persona of ['support', 'incident', 'pa', 'nope', undefined]) {
    it(`rejects the non-exec persona ${JSON.stringify(persona)} before any Brain/section work`, async () => {
      const res = await post({ persona, threadId: 'web:1', message: 'status?' });
      const body = await res.json();
      expect(body.status).toBe('error');
      expect(body.error).toMatch(/ceo, cto, risk/);
      // Rejected up front: no section check, no Brain turn.
      expect(h.requireSectionApi).not.toHaveBeenCalled();
      expect(h.runPaTurn).not.toHaveBeenCalled();
    });
  }
});

describe('exec invoke route — CTO reaches the approval queue', () => {
  it('persists a CTO gated interrupt as an action proposal', async () => {
    h.runPaTurn.mockResolvedValue({
      status: 'pending_approval',
      reply: 'Proposing a deploy.',
      pending: {
        tool: 'triggerWorkflow',
        args: { repo: 'lewis159/youtube-transcriber', workflowId: 'deploy.yml', ref: 'main' },
        describe: 'Trigger workflow deploy.yml on lewis159/youtube-transcriber@main',
        callId: 'call_x1',
      },
    });

    const res = await post({ persona: 'cto', threadId: 'web:1', message: 'ship it' });
    const body = await res.json();

    expect(body.status).toBe('pending_approval');
    expect(body.proposalId).toBe('prop_123');
    expect(h.saveActionProposal).toHaveBeenCalledTimes(1);
    expect(h.saveActionProposal.mock.calls[0][0]).toMatchObject({
      agent: 'cto',
      persona: 'cto',
      tool: 'triggerWorkflow',
    });
  });
});

describe('exec invoke route — Risk stays advisory (no gated action)', () => {
  it('refuses to raise a proposal even if a pending interrupt somehow surfaced', async () => {
    // Defensive: force a (contract-violating) pending interrupt for Risk.
    h.runPaTurn.mockResolvedValue({
      status: 'pending_approval',
      reply: 'x',
      pending: { tool: 'updateTicket', args: {}, describe: 'x', callId: 'c1' },
    });

    const res = await post({ persona: 'risk', threadId: 'web:1', message: 'assess' });
    const body = await res.json();

    expect(body.status).toBe('error');
    expect(body.error).toMatch(/advisory-only/);
    // Crucially: NO action proposal was raised for the advisory exec.
    expect(h.saveActionProposal).not.toHaveBeenCalled();
  });

  it('a normal Risk turn answers with no proposal', async () => {
    const res = await post({ persona: 'risk', threadId: 'web:1', message: 'assess' });
    const body = await res.json();
    expect(body.status).toBe('answered');
    expect(h.saveActionProposal).not.toHaveBeenCalled();
  });
});
