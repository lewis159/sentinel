// PA surface: a Discord message → the Hermes Brain PA → a reply.
//
// Scope (consistent with how the bot already scopes ticket threads by channel):
//   • any message in the configured PA channel (DISCORD_PA_CHANNEL_ID), or
//   • an @mention of the bot in a guild text channel, or
//   • a direct message to the bot.
// The channel id is the Brain thread key (server-side thread = `discord:<id>`), so
// each channel / DM is its own persistent PA conversation.
//
// The bot holds NO brain logic — it just relays to /api/bot/pa/chat and posts the
// reply. A gated action comes back as 'pending_approval': Sentinel has already
// queued it to #approvals (Approve/Dismiss buttons via the poller), so here we just
// tell the user it was flagged.

import { ChannelType, type Client, type Message } from 'discord.js';
import type { Config } from '../config.js';
import type { SentinelClient } from '../sentinel.js';

const DISCORD_MAX = 2000;

// Split a reply into Discord-sized chunks (2000 char hard limit), on line
// boundaries where possible so we don't cut mid-word.
function chunk(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > DISCORD_MAX) {
    let cut = rest.lastIndexOf('\n', DISCORD_MAX);
    if (cut < DISCORD_MAX * 0.5) cut = DISCORD_MAX; // no good break → hard cut
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

// Should this message be handled by the PA? Returns the cleaned text, or null.
function paTextFor(message: Message, cfg: Config, botId: string | undefined): string | null {
  const isPaChannel = Boolean(cfg.channels.pa) && message.channel.id === cfg.channels.pa;
  const isDm = message.channel.type === ChannelType.DM;
  const mentioned = botId ? message.mentions.users.has(botId) : false;

  if (!isPaChannel && !isDm && !mentioned) return null;

  // Strip a leading @mention so the model doesn't see "<@123> hi".
  let text = message.content ?? '';
  if (mentioned && botId) {
    text = text.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim();
  }
  text = text.trim();
  return text || null;
}

export async function handlePaMessage(
  message: Message,
  cfg: Config,
  sentinel: SentinelClient,
  client: Client,
): Promise<void> {
  if (message.author.bot) return;
  // Ticket-thread replies are owned by handleThreadMessage — don't double-handle
  // unless the bot was explicitly @mentioned in that thread.
  const botId = client.user?.id;
  const mentioned = botId ? message.mentions.users.has(botId) : false;
  if (message.channel.isThread() && !mentioned) return;

  const text = paTextFor(message, cfg, botId);
  if (text === null) return;

  // Show a typing indicator while the Brain thinks (best-effort).
  if ('sendTyping' in message.channel) {
    await (message.channel as { sendTyping: () => Promise<void> }).sendTyping().catch(() => {});
  }

  try {
    const res = await sentinel.paChat(message.channel.id, text, message.author.username);

    if (res.status === 'disabled') {
      await message.reply('🧠 The PA is currently disabled.');
      return;
    }
    if (res.status === 'error') {
      await message.reply(`⚠️ ${res.error ?? 'PA error'}`);
      return;
    }
    if (res.status === 'pending_approval') {
      const lead = res.reply ? `${res.reply}\n\n` : '';
      await message.reply(
        `${lead}🔒 That needs your approval — I've flagged it in **#approvals**.`,
      );
      return;
    }

    // answered
    const reply = res.reply?.trim() || '(no reply)';
    const parts = chunk(reply);
    await message.reply(parts[0]);
    for (const part of parts.slice(1)) {
      if ('send' in message.channel) {
        await (message.channel as { send: (c: string) => Promise<unknown> }).send(part);
      }
    }
  } catch (e: any) {
    await message.reply(`❌ ${e?.message ?? 'PA request failed'}`).catch(() => {});
  }
}
