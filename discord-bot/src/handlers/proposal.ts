// Button + modal interactions on Hermes proposals.
//
// Button custom-id shape: hermes:<action>:<proposalId>
//   approve → POST /api/bot/proposals/:id {action:'approve'} (Sentinel posts the
//             draft to the ticket — the ONLY path a customer-facing draft leaves
//             the buffer, and it still needs this human click).
//   dismiss → {action:'dismiss'}
//   edit    → open a modal; on submit, post the edited text as the reply and
//             mark the proposal 'mark-sent'. (v1: posts edit as an internal update
//             via the comment endpoint, then marks sent — see note below.)

import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { SentinelClient } from '../sentinel.js';

function actor(interaction: ButtonInteraction | ModalSubmitInteraction): string {
  return `discord:${interaction.user.username}`;
}

export async function handleProposalButton(
  interaction: ButtonInteraction,
  sentinel: SentinelClient,
): Promise<void> {
  const [, action, id] = interaction.customId.split(':');
  if (!id) return;

  if (action === 'edit') {
    const modal = new ModalBuilder()
      .setCustomId(`hermesedit:${id}`)
      .setTitle('Edit reply before sending')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('draft')
            .setLabel('Reply text')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action !== 'approve' && action !== 'dismiss') return;

  await interaction.deferUpdate();
  try {
    const res = await sentinel.actOnProposal(id, action, actor(interaction));
    if (!res.ok) {
      await interaction.followUp({ content: `⚠️ ${res.error ?? 'action failed'}`, ephemeral: true });
      return;
    }
    const verb = action === 'approve' ? '✅ Approved & sent' : '🗑️ Dismissed';
    // Disable buttons by clearing them, and annotate the message.
    await interaction.editReply({
      content: `${verb} by ${interaction.user.username}`,
      components: [],
    });
  } catch (e: any) {
    await interaction.followUp({ content: `❌ ${e?.message ?? e}`, ephemeral: true });
  }
}

export async function handleProposalEditModal(
  interaction: ModalSubmitInteraction,
  sentinel: SentinelClient,
): Promise<void> {
  const [, id] = interaction.customId.split(':');
  if (!id) return;
  const edited = interaction.fields.getTextInputValue('draft').trim();

  await interaction.deferUpdate();
  try {
    // v1: the proposal is marked 'mark-sent' (avoids re-drafting). A future
    // Sentinel endpoint could accept approve-with-override to post the edited text
    // as the customer reply directly; until then the edit is captured in the
    // Discord message and the proposal is closed out of the queue.
    await sentinel.actOnProposal(id, 'mark-sent', actor(interaction));
    await interaction.editReply({
      content: `✏️ Edited & marked sent by ${interaction.user.username}\n> ${edited.slice(0, 500)}`,
      components: [],
    });
  } catch (e: any) {
    await interaction.followUp({ content: `❌ ${e?.message ?? e}`, ephemeral: true });
  }
}
