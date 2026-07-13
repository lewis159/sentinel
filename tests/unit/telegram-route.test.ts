import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Telegram webhook ROUTE (app/api/hermes/channels/telegram/route.ts).
//
// Proves, WITHOUT a real DB / Telegram / Brain (flag, Brain, proposals, audit and
// the adapter are all mocked):
//   • flag off → 404, adapter + Brain never touched (surface not revealed),
//   • bad secret → 401, Brain never called,
//   • non-message update → 200, Brain never called,
//   • an UN-allowlisted chat id → polite refusal, Brain NEVER called,
//   • empty allowlist → nobody authorised (fail-closed),
//   • an allowlisted chat id → routed to runPaTurn on persona 'pa', reply sent,
//     audited as channel.telegram.message,
//   • a gated tool → persisted as a proposal + "queued for approval" reply (no
//     execution from Telegram),
//   • a Brain error → generic reply + 200 (no Telegram retry storm).
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  getRuntimeFlag: vi.fn(async () => true),
  runPaTurn: vi.fn(async () => ({ status: 'answered', reply: 'hi from brain' }) as any),
  saveActionProposal: vi.fn(async () => 'PROP-1'),
  appendAudit: vi.fn(async () => ({}) as any),
  verifyInbound: vi.fn(async () => ({ ok: true }) as any),
  parseInbound: vi.fn(() => ({ chatId: '4242', userId: '777', text: 'hello' }) as any),
  sendReply: vi.fn(async () => {}),
}));

vi.mock('@/lib/hermes/runtime-flags', () => ({ getRuntimeFlag: h.getRuntimeFlag }));
vi.mock('@/lib/hermes/brain/graph', () => ({ runPaTurn: h.runPaTurn }));
vi.mock('@/lib/hermes/proposals', () => ({ saveActionProposal: h.saveActionProposal }));
vi.mock('@/lib/hermes/audit', () => ({ appendAudit: h.appendAudit }));
vi.mock('@/lib/hermes/channels/telegram', () => ({
  telegramAdapter: {
    name: 'telegram',
    verifyInbound: h.verifyInbound,
    parseInbound: h.parseInbound,
    sendReply: h.sendReply,
  },
}));

import { POST } from '@/app/api/hermes/channels/telegram/route';

function post(body: unknown): Request {
  return new Request('https://x/api/hermes/channels/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const anyUpdate = { message: { chat: { id: 4242 }, from: { id: 777 }, text: 'hi' } };

describe('telegram webhook route', () => {
  const OLD = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  beforeEach(() => {
    for (const fn of Object.values(h)) (fn as any).mockClear();
    h.getRuntimeFlag.mockResolvedValue(true);
    h.runPaTurn.mockResolvedValue({ status: 'answered', reply: 'hi from brain' } as any);
    h.saveActionProposal.mockResolvedValue('PROP-1');
    h.verifyInbound.mockResolvedValue({ ok: true } as any);
    h.parseInbound.mockReturnValue({ chatId: '4242', userId: '777', text: 'hello' } as any);
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = '4242';
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
    else process.env.TELEGRAM_ALLOWED_CHAT_IDS = OLD;
  });

  it('flag off → 404, adapter + Brain never touched', async () => {
    h.getRuntimeFlag.mockResolvedValue(false);
    const res = await POST(post(anyUpdate));
    expect(res.status).toBe(404);
    expect(h.verifyInbound).not.toHaveBeenCalled();
    expect(h.runPaTurn).not.toHaveBeenCalled();
  });

  it('bad secret → 401, Brain never called', async () => {
    h.verifyInbound.mockResolvedValue({ ok: false, status: 401 } as any);
    const res = await POST(post(anyUpdate));
    expect(res.status).toBe(401);
    expect(h.runPaTurn).not.toHaveBeenCalled();
  });

  it('unconfigured secret → 503 propagated', async () => {
    h.verifyInbound.mockResolvedValue({ ok: false, status: 503 } as any);
    const res = await POST(post(anyUpdate));
    expect(res.status).toBe(503);
    expect(h.runPaTurn).not.toHaveBeenCalled();
  });

  it('non-message update → 200, Brain never called', async () => {
    h.parseInbound.mockReturnValue(null);
    const res = await POST(post({ update_id: 1 }));
    expect(res.status).toBe(200);
    expect(h.runPaTurn).not.toHaveBeenCalled();
  });

  it('un-allowlisted chat id → refusal reply, Brain NEVER called, 200', async () => {
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = '9999';
    const res = await POST(post(anyUpdate));
    expect(res.status).toBe(200);
    expect(h.runPaTurn).not.toHaveBeenCalled();
    expect(h.sendReply).toHaveBeenCalledOnce();
    expect(String(h.sendReply.mock.calls[0][1])).toMatch(/not authorized/i);
  });

  it('empty allowlist → nobody authorised (fail-closed)', async () => {
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = '';
    await POST(post(anyUpdate));
    expect(h.runPaTurn).not.toHaveBeenCalled();
  });

  it('allowlisted chat id → routed to Brain (persona pa), reply sent, audited', async () => {
    const res = await POST(post(anyUpdate));
    expect(res.status).toBe(200);
    expect(h.runPaTurn).toHaveBeenCalledOnce();
    expect(h.runPaTurn.mock.calls[0][0]).toMatchObject({
      threadId: 'telegram:4242',
      persona: 'pa',
      actor: 'telegram:777',
      message: 'hello',
    });
    expect(h.sendReply).toHaveBeenCalledWith('4242', 'hi from brain');
    expect(h.appendAudit).toHaveBeenCalledOnce();
    expect(h.appendAudit.mock.calls[0][0]).toMatchObject({
      action: 'channel.telegram.message',
      actor: 'telegram:777',
      tenantRef: 'telegram:4242',
    });
  });

  it('gated tool → persists a proposal and replies "queued for approval" (no execution)', async () => {
    h.runPaTurn.mockResolvedValue({
      status: 'pending_approval',
      reply: 'I can restart it,',
      pending: {
        tool: 'deploy.restart',
        args: { ref: 'svc' },
        describe: 'restart svc',
        callId: 'c1',
      },
    } as any);
    const res = await POST(post(anyUpdate));
    expect(res.status).toBe(200);
    expect(h.saveActionProposal).toHaveBeenCalledOnce();
    expect(h.saveActionProposal.mock.calls[0][0]).toMatchObject({
      agent: 'pa',
      persona: 'pa',
      tool: 'deploy.restart',
      threadId: 'telegram:4242',
    });
    const reply = String(h.sendReply.mock.calls[0][1]);
    expect(reply).toMatch(/approval/i);
    expect(reply).toMatch(/PROP-1/);
  });

  it('Brain error is swallowed → generic reply, 200 (no Telegram retry storm)', async () => {
    h.runPaTurn.mockRejectedValue(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(post(anyUpdate));
    expect(res.status).toBe(200);
    expect(String(h.sendReply.mock.calls[0][1])).toMatch(/went wrong/i);
    errSpy.mockRestore();
  });
});
