import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Onboarding assistant — nudge gating (lib/onboarding/nudge.ts).
//
// Two invariants proven here:
//   1. DORMANT-SAFE: with the Brain OFF (default), draftNudge returns the
//      deterministic template and makes NO model call.
//   2. DRAFT-ONLY: queueNudge raises the draft to the approval gate via
//      saveProposal (kind 'onboarding-nudge') and NEVER sends — no email tool,
//      no auto-send path is touched.
//
// We mock the substrate: server-only is inert, the OpenRouter chat client + the
// proposals store are spies, so nothing hits the network or a DB.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const chat = vi.fn(async () => ({
    ok: true,
    content: 'Hi Acme — a warmer, AI-personalised nudge about AI summary.',
    model: 'anthropic/claude-3.5-sonnet',
  }));
  const saveProposal = vi.fn(async () => 'proposal-123');
  return { chat, saveProposal };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/hermes/openrouter', () => ({ chat: H.chat }));
vi.mock('@/lib/hermes/proposals', () => ({ saveProposal: H.saveProposal }));

import { draftNudge, queueNudge, ONBOARDING_NUDGE_KIND } from '@/lib/onboarding/nudge';
import { computeOnboardingProgress, type OnboardingCustomer } from '@/lib/onboarding/progress';

const NOW = new Date('2026-07-12T12:00:00Z');

function progress() {
  const c: OnboardingCustomer = {
    id: 'acme',
    name: 'Acme Co',
    email: 'ops@acme.co',
    tier: 'pro',
    signupAt: new Date('2026-07-10T12:00:00Z').toISOString(),
    memberCount: 1,
    hasFirstJob: true,
    jobCount: 3,
    usedFeatures: ['transcribe'],
    contactedSupport: true,
  };
  return computeOnboardingProgress(c, NOW);
}

const prevBrain = process.env.HERMES_BRAIN_ENABLED;

beforeEach(() => {
  H.chat.mockClear();
  H.saveProposal.mockClear();
});

afterEach(() => {
  if (prevBrain === undefined) delete process.env.HERMES_BRAIN_ENABLED;
  else process.env.HERMES_BRAIN_ENABLED = prevBrain;
});

describe('draftNudge — Brain OFF (dormant-safe)', () => {
  it('returns the template and makes NO model call', async () => {
    delete process.env.HERMES_BRAIN_ENABLED;
    const draft = await draftNudge(progress());

    expect(H.chat).not.toHaveBeenCalled();
    expect(draft.personalised).toBe(false);
    expect(draft.featureKey).toBe('ai_summary');
    expect(draft.subject).toContain('AI summary');
    expect(draft.model).toBeUndefined();
  });
});

describe('draftNudge — Brain ON', () => {
  it('personalises the body via the LLM but keeps the recommended feature', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    const draft = await draftNudge(progress());

    expect(H.chat).toHaveBeenCalledTimes(1);
    expect(draft.personalised).toBe(true);
    expect(draft.featureKey).toBe('ai_summary'); // recommendation unchanged
    expect(draft.body).toContain('AI-personalised');
    expect(draft.model).toBe('anthropic/claude-3.5-sonnet');
  });

  it('falls back to the template when the model call fails', async () => {
    process.env.HERMES_BRAIN_ENABLED = '1';
    H.chat.mockResolvedValueOnce({ ok: false, content: undefined, error: 'boom' } as any);
    const draft = await draftNudge(progress());

    expect(H.chat).toHaveBeenCalledTimes(1);
    expect(draft.personalised).toBe(false); // template body survived
    expect(draft.featureKey).toBe('ai_summary');
  });
});

describe('queueNudge — draft-only, never sends', () => {
  it('raises a onboarding-nudge proposal to the gate and does not send', async () => {
    delete process.env.HERMES_BRAIN_ENABLED;
    const res = await queueNudge({ progress: progress(), by: 'ben' });

    // Exactly one proposal saved; NO chat/email/send anywhere.
    expect(H.saveProposal).toHaveBeenCalledTimes(1);
    expect(H.chat).not.toHaveBeenCalled();

    const arg = H.saveProposal.mock.calls[0][0] as any;
    expect(arg.kind).toBe(ONBOARDING_NUDGE_KIND);
    expect(arg.kind).toBe('onboarding-nudge');
    expect(arg.agent).toBe('onboarding');
    expect(arg.ref).toBe('acme');
    // The proposal carries a DRAFT (copilot), not an executable action/tool call.
    expect(arg.proposal.draft).toContain('Subject:');
    expect(arg.proposal.action).toBeUndefined();

    expect(res.ok).toBe(true);
    expect(res.proposalId).toBe('proposal-123');
    expect(res.draft.featureKey).toBe('ai_summary');
  });

  it('reports a null proposalId (no DB) without throwing', async () => {
    delete process.env.HERMES_BRAIN_ENABLED;
    H.saveProposal.mockResolvedValueOnce(null);
    const res = await queueNudge({ progress: progress() });
    expect(res.ok).toBe(true);
    expect(res.proposalId).toBeNull();
  });
});
