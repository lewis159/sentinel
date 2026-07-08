// Render Sentinel state as Discord embeds + button rows.
//
// Button custom-ids encode the action + target so the interaction handler can
// route without external state:  hermes:<action>:<proposalId>
// Actions: approve | dismiss | edit.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { HermesProposal, ProposalRecord, TicketEvent } from './sentinel.js';

const PRIORITY_COLOR: Record<string, number> = {
  critical: 0xef4444,
  urgent: 0xef4444,
  high: 0xf59e0b,
  medium: 0x3b82f6,
  low: 0x6b7280,
};

function colorFor(priority?: string): number {
  return PRIORITY_COLOR[(priority ?? '').toLowerCase()] ?? 0x3b82f6;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// The Approve / Edit / Dismiss button row for a Hermes proposal.
export function proposalButtons(id: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`hermes:approve:${id}`)
      .setLabel('Approve & send')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`hermes:edit:${id}`)
      .setLabel('Edit')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`hermes:dismiss:${id}`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Danger),
  );
}

// Embed for a Hermes proposal (from triage response or the poll queue).
export function proposalEmbed(opts: {
  ref: string;
  agent: string;
  proposal: HermesProposal;
}): EmbedBuilder {
  const { ref, agent, proposal } = opts;
  const embed = new EmbedBuilder()
    .setTitle(`Hermes draft · ${ref}`)
    .setColor(colorFor(proposal.priority))
    .setFooter({ text: `agent: ${agent}${proposal.model ? ` · ${proposal.model}` : ''} · copilot — human approves` });

  if (!proposal.configured) {
    embed.setDescription('⚠️ Hermes is not configured (no OPENROUTER_API_KEY on Sentinel). No draft produced.');
    return embed;
  }
  if (!proposal.ok) {
    embed.setDescription(`⚠️ Triage failed: ${proposal.error ?? 'unknown error'}`);
    return embed;
  }

  if (proposal.classification) embed.addFields({ name: 'Classification', value: truncate(proposal.classification, 256) });
  const meta: string[] = [];
  if (proposal.priority) meta.push(`**Priority:** ${proposal.priority}`);
  if (typeof proposal.confidence === 'number') meta.push(`**Confidence:** ${proposal.confidence}%`);
  if (meta.length) embed.addFields({ name: 'Assessment', value: meta.join('  ·  ') });
  if (proposal.draft) embed.addFields({ name: 'Draft reply', value: truncate(proposal.draft, 1024) });
  if (proposal.reasoning) embed.addFields({ name: 'Reasoning', value: truncate(proposal.reasoning, 512) });
  if (proposal.sources?.length) embed.addFields({ name: 'Sources', value: truncate(proposal.sources.join(', '), 256) });
  return embed;
}

// Embed for a queued proposal record (poll path — carries id + title).
export function queuedProposalEmbed(rec: ProposalRecord): EmbedBuilder {
  return proposalEmbed({ ref: rec.ref, agent: rec.agent, proposal: rec.proposal })
    .setTitle(`Hermes draft · ${rec.ref} — ${truncate(rec.title, 80)}`);
}

// Embed for an outbound ticket event (new/updated ticket).
export function eventEmbed(ev: TicketEvent): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${ev.kind.toUpperCase()} · ${ev.ref}`)
    .setDescription(truncate(ev.title, 256))
    .setColor(colorFor(ev.priority))
    .addFields(
      { name: 'Status', value: ev.status || '—', inline: true },
      { name: 'Priority', value: ev.priority || '—', inline: true },
      { name: 'App', value: ev.app || '—', inline: true },
    )
    .setFooter({ text: ev.slaDue ? `SLA due ${ev.slaDue}` : 'no SLA' });
}
