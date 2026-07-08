// Two-way ticket updates: a reply in a ticket's thread → an internal ticket
// comment via the bot API. GUARDRAIL: this posts an INTERNAL update, never a
// customer-facing reply (those always go through a Hermes proposal + approve).

import type { Message } from 'discord.js';
import type { SentinelClient } from '../sentinel.js';
import { refForThread } from '../state.js';

export async function handleThreadMessage(
  message: Message,
  sentinel: SentinelClient,
): Promise<void> {
  if (message.author.bot) return;
  if (!message.channel.isThread()) return;

  const ref = refForThread(message.channel.id);
  if (!ref) return; // not a ticket thread we track

  const body = message.content.trim();
  if (!body) return;

  try {
    await sentinel.addComment(ref, body, `discord:${message.author.username}`, 'update');
    await message.react('✅');
  } catch {
    await message.react('⚠️');
  }
}
