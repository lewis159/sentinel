// Telegram channel adapter — the first concrete ChannelAdapter.
//
// Inbound: Telegram delivers Updates to the webhook you register with setWebhook.
// When you register with a `secret_token`, Telegram echoes it back on EVERY
// request in the `X-Telegram-Bot-Api-Secret-Token` header — we verify that,
// constant-time, against TELEGRAM_WEBHOOK_SECRET (same style as lib/ingest-auth).
//
// Outbound: sendMessage to the Bot API using TELEGRAM_BOT_TOKEN.
//
// Secrets resolve env-first, then Infisical (getSecret) — identical to the other
// integration tools. The bot token is server-only and NEVER placed in any client.
import 'server-only';
import crypto from 'crypto';
import { getSecret } from '@/lib/secrets';
import type { ChannelAdapter, ChannelVerifyResult, InboundMessage } from './types';

// Telegram sets this header on every webhook call to the value of `secret_token`
// passed at setWebhook time. Header names are case-insensitive (Headers.get
// normalises), so this exact casing is fine.
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

// Constant-time UTF-8 string compare — mirrors ingest-auth's timingSafeEqualStr.
// Length-mismatch and empty are non-matches WITHOUT leaking via early return
// timing beyond the unavoidable length check.
function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// TELEGRAM_BOT_TOKEN: env first, then Infisical fallback. Server-only.
async function botToken(): Promise<string | undefined> {
  return process.env.TELEGRAM_BOT_TOKEN || (await getSecret('TELEGRAM_BOT_TOKEN')) || undefined;
}

// TELEGRAM_WEBHOOK_SECRET: env first, then Infisical fallback. Server-only.
async function webhookSecret(): Promise<string | undefined> {
  return (
    process.env.TELEGRAM_WEBHOOK_SECRET || (await getSecret('TELEGRAM_WEBHOOK_SECRET')) || undefined
  );
}

export const telegramAdapter: ChannelAdapter = {
  name: 'telegram',

  async verifyInbound(req: Request): Promise<ChannelVerifyResult> {
    const secret = await webhookSecret();
    // No secret configured → cannot authenticate anything. 503 (operator setup
    // gap), distinct from a genuine mismatch so setup problems are diagnosable.
    if (!secret) return { ok: false, status: 503 };

    const presented = req.headers.get(SECRET_HEADER) ?? '';
    if (presented && timingSafeEqualStr(presented, secret)) return { ok: true };
    return { ok: false, status: 401 };
  },

  parseInbound(body: unknown): InboundMessage | null {
    if (!body || typeof body !== 'object') return null;
    // We read ONLY the fields we need and normalise their types; every other
    // client-supplied field on the Update is ignored.
    const msg = (body as Record<string, unknown>).message;
    if (!msg || typeof msg !== 'object') return null; // edits / callbacks / etc → ignore

    const m = msg as Record<string, unknown>;
    const chat = m.chat as Record<string, unknown> | undefined;
    const from = m.from as Record<string, unknown> | undefined;
    const text = m.text;

    // A message with no text body (photo, sticker, …) is ignored.
    if (typeof text !== 'string' || text.trim() === '') return null;
    if (!chat || (typeof chat.id !== 'number' && typeof chat.id !== 'string')) return null;

    const chatId = String(chat.id);
    // from can be absent for channel posts; fall back to the chat id for the
    // actor label so we never route with an undefined user.
    const userId =
      from && (typeof from.id === 'number' || typeof from.id === 'string')
        ? String(from.id)
        : chatId;

    return { chatId, userId, text };
  },

  async sendReply(chatId: string, text: string): Promise<void> {
    const token = await botToken();
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN not configured — cannot send reply.');
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      throw new Error(`Telegram sendMessage failed (HTTP ${res.status})`);
    }
  },
};
