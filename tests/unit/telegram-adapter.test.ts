import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Telegram channel ADAPTER (lib/hermes/channels/telegram.ts).
//
// Proves, WITHOUT Telegram or Infisical:
//   • verifyInbound: matching secret → ok; wrong/missing header → 401;
//     unconfigured secret → 503. Compare is constant-time (crypto.timingSafeEqual)
//     — exercised via same-length-different and length-mismatch inputs.
//   • parseInbound: a text message → {chatId,userId,text}; a non-message update,
//     a text-less message, and non-object bodies → null (ignored).
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

const secretMock = vi.hoisted(() => ({ getSecret: vi.fn(async () => undefined) }));
vi.mock('@/lib/secrets', () => secretMock);

import { telegramAdapter } from '@/lib/hermes/channels/telegram';

function reqWithSecret(headerVal?: string): Request {
  const headers = new Headers();
  if (headerVal !== undefined) headers.set('X-Telegram-Bot-Api-Secret-Token', headerVal);
  return new Request('https://x/api/hermes/channels/telegram', { method: 'POST', headers });
}

describe('telegram adapter · verifyInbound', () => {
  const OLD = process.env.TELEGRAM_WEBHOOK_SECRET;
  afterEach(() => {
    if (OLD === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = OLD;
    secretMock.getSecret.mockReset();
    secretMock.getSecret.mockResolvedValue(undefined);
  });

  it('503 when no webhook secret is configured (env + Infisical both empty)', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(await telegramAdapter.verifyInbound(reqWithSecret('anything'))).toEqual({
      ok: false,
      status: 503,
    });
  });

  it('ok when the header matches the configured secret', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 's3cr3t-token-value';
    expect(await telegramAdapter.verifyInbound(reqWithSecret('s3cr3t-token-value'))).toEqual({
      ok: true,
    });
  });

  it('401 when the header is present but wrong (same length → constant-time compare)', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'aaaaaaaa';
    expect(await telegramAdapter.verifyInbound(reqWithSecret('bbbbbbbb'))).toEqual({
      ok: false,
      status: 401,
    });
  });

  it('401 on a length-mismatched secret (no crash from timingSafeEqual)', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'aaaaaaaa';
    expect(await telegramAdapter.verifyInbound(reqWithSecret('bb'))).toEqual({
      ok: false,
      status: 401,
    });
  });

  it('401 when the secret header is missing entirely', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 's3cr3t-token-value';
    expect(await telegramAdapter.verifyInbound(reqWithSecret(undefined))).toEqual({
      ok: false,
      status: 401,
    });
  });

  it('falls back to Infisical getSecret when env is unset', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    secretMock.getSecret.mockResolvedValue('from-infisical');
    expect(await telegramAdapter.verifyInbound(reqWithSecret('from-infisical'))).toEqual({
      ok: true,
    });
    expect(await telegramAdapter.verifyInbound(reqWithSecret('nope'))).toEqual({
      ok: false,
      status: 401,
    });
  });
});

describe('telegram adapter · parseInbound', () => {
  it('extracts chatId, userId, text from a text message update', () => {
    const update = {
      update_id: 1,
      message: { message_id: 9, chat: { id: 4242 }, from: { id: 777 }, text: 'hello' },
    };
    expect(telegramAdapter.parseInbound(update)).toEqual({
      chatId: '4242',
      userId: '777',
      text: 'hello',
    });
  });

  it('returns null for a non-message update (edited_message / callback_query)', () => {
    expect(telegramAdapter.parseInbound({ update_id: 2, edited_message: { text: 'x' } })).toBeNull();
    expect(telegramAdapter.parseInbound({ update_id: 3, callback_query: {} })).toBeNull();
  });

  it('returns null for a message with no text (photo/sticker) or empty text', () => {
    expect(
      telegramAdapter.parseInbound({ message: { chat: { id: 1 }, from: { id: 2 } } }),
    ).toBeNull();
    expect(
      telegramAdapter.parseInbound({ message: { chat: { id: 1 }, from: { id: 2 }, text: '   ' } }),
    ).toBeNull();
  });

  it('falls back to chatId for userId when `from` is absent (channel post)', () => {
    expect(telegramAdapter.parseInbound({ message: { chat: { id: 55 }, text: 'hi' } })).toEqual({
      chatId: '55',
      userId: '55',
      text: 'hi',
    });
  });

  it('returns null for non-object bodies', () => {
    expect(telegramAdapter.parseInbound(null)).toBeNull();
    expect(telegramAdapter.parseInbound('nope')).toBeNull();
  });
});
