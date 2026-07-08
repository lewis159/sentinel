// /ticket slash command → create a Sentinel ticket, then surface the Hermes draft
// as an embed with Approve/Edit/Dismiss buttons, and open a thread for the
// ticket's ongoing conversation (two-way updates land there).

import {
  ChannelType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SentinelClient } from '../sentinel.js';
import { proposalEmbed, proposalButtons } from '../embeds.js';
import { mapThread } from '../state.js';

export async function handleTicketCommand(
  interaction: ChatInputCommandInteraction,
  sentinel: SentinelClient,
): Promise<void> {
  const kind = interaction.options.getString('kind', true);
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description') ?? undefined;
  const priority = interaction.options.getString('priority') ?? undefined;

  await interaction.deferReply();

  let ref: string;
  try {
    const res = await sentinel.createTicket({
      kind,
      title,
      description,
      priority,
      app: 'Discord',
    });
    ref = res.ref;
  } catch (e: any) {
    await interaction.editReply(`❌ Could not create ticket: ${e?.message ?? e}`);
    return;
  }

  // Ask Hermes to draft (idempotent w.r.t. auto-triage — this guarantees a draft
  // to show even if HERMES_AUTO_TRIAGE is off). Copilot-first: draft only.
  let content = `✅ Created **${ref}** — *${title}*`;
  try {
    const proposal = await sentinel.triage(ref, 'support');
    const embed = proposalEmbed({ ref, agent: 'support', proposal });
    const components = proposal.ok && proposal.id ? [proposalButtons(proposal.id)] : [];
    await interaction.editReply({ content, embeds: [embed], components });
  } catch (e: any) {
    await interaction.editReply(`${content}\n⚠️ Hermes draft unavailable: ${e?.message ?? e}`);
  }

  // Open a thread on the reply for the ticket conversation → thread replies become
  // ticket comments (handlers/thread.ts).
  try {
    const msg = await interaction.fetchReply();
    if ('startThread' in msg && interaction.channel?.type === ChannelType.GuildText) {
      const thread = await msg.startThread({ name: `${ref} · ${title}`.slice(0, 100) });
      mapThread(thread.id, ref);
    }
  } catch {
    /* threads unsupported in this channel type — non-fatal */
  }
}
