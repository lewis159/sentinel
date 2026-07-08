// Outbound polling loop (the chosen model — see docs/discord-integration.md §6.3).
// The bot PULLS from Sentinel; Sentinel needs zero knowledge of the bot.
//
//   1. Pending Hermes proposals → posted to #approvals as embeds with buttons.
//   2. New/updated tickets       → posted to #incidents / #tickets.
//
// Dedupe by proposal id / ticket ref (state.ts) so re-polls never double-post.

import { EmbedBuilder, type Client, type TextBasedChannel } from 'discord.js';
import type { Config } from './config.js';
import type { SentinelClient } from './sentinel.js';
import { queuedProposalEmbed, proposalButtons, eventEmbed } from './embeds.js';
import {
  markProposalPosted,
  markEventPosted,
  getEventCursor,
  setEventCursor,
} from './state.js';

async function sendTo(
  client: Client,
  channelId: string | undefined,
  payload: { embeds: EmbedBuilder[]; components?: any[] },
): Promise<void> {
  if (!channelId) return;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (ch && ch.isTextBased() && 'send' in ch) {
    await (ch as TextBasedChannel & { send: Function }).send(payload).catch((e: any) =>
      console.error('send failed:', e?.message ?? e),
    );
  }
}

async function pollProposals(client: Client, cfg: Config, sentinel: SentinelClient): Promise<void> {
  const { proposals } = await sentinel.listProposals('pending');
  for (const rec of proposals) {
    if (!markProposalPosted(rec.id)) continue;
    await sendTo(client, cfg.channels.approvals, {
      embeds: [queuedProposalEmbed(rec)],
      components: [proposalButtons(rec.id)],
    });
  }
}

async function pollEvents(client: Client, cfg: Config, sentinel: SentinelClient): Promise<void> {
  const { events, cursor } = await sentinel.getEvents(getEventCursor());
  for (const ev of events) {
    if (!markEventPosted(ev.ref)) continue;
    const channelId = ev.channel === 'incidents' ? cfg.channels.incidents : cfg.channels.tickets;
    await sendTo(client, channelId, { embeds: [eventEmbed(ev)] });
  }
  if (cursor) setEventCursor(cursor);
}

export function startPoller(client: Client, cfg: Config, sentinel: SentinelClient): void {
  const tick = async () => {
    try {
      await Promise.all([
        pollProposals(client, cfg, sentinel),
        pollEvents(client, cfg, sentinel),
      ]);
    } catch (e: any) {
      console.error('poll error:', e?.message ?? e);
    }
  };
  console.log(`Polling Sentinel every ${cfg.pollIntervalMs}ms`);
  setInterval(tick, cfg.pollIntervalMs);
  void tick();
}
