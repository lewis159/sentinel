// Slash-command definitions. Registered per-guild (instant) via register.ts.

import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open a Sentinel ticket (Hermes will draft a reply for approval)')
    .addStringOption((o) =>
      o
        .setName('kind')
        .setDescription('ITIL kind')
        .setRequired(true)
        .addChoices(
          { name: 'incident', value: 'incident' },
          { name: 'request', value: 'request' },
          { name: 'change', value: 'change' },
          { name: 'problem', value: 'problem' },
          { name: 'release', value: 'release' },
        ),
    )
    .addStringOption((o) =>
      o.setName('title').setDescription('Short summary').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('description').setDescription('Details').setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('priority')
        .setDescription('Priority')
        .setRequired(false)
        .addChoices(
          { name: 'critical', value: 'critical' },
          { name: 'high', value: 'high' },
          { name: 'medium', value: 'medium' },
          { name: 'low', value: 'low' },
        ),
    ),
].map((c) => c.toJSON());
