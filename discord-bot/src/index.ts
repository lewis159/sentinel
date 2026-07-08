// Bot entrypoint — bootstrap the client, wire interactions + thread replies, log
// in, and start the outbound poller. All ops decisions live in Sentinel; this
// process only translates Discord ↔ the /api/bot/* surface.

import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config.js';
import { SentinelClient } from './sentinel.js';
import { handleTicketCommand } from './handlers/ticket.js';
import { handleProposalButton, handleProposalEditModal } from './handlers/proposal.js';
import { handleThreadMessage } from './handlers/thread.js';
import { startPoller } from './poller.js';

async function main() {
  const cfg = await loadConfig();
  const sentinel = new SentinelClient(cfg.sentinelBase, cfg.botToken);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      // MessageContent is a privileged intent — enable it in the Developer Portal.
      // Needed to read thread replies for two-way ticket updates.
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    startPoller(client, cfg, sentinel);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'ticket') {
        await handleTicketCommand(interaction, sentinel);
      } else if (interaction.isButton() && interaction.customId.startsWith('hermes:')) {
        await handleProposalButton(interaction, sentinel);
      } else if (interaction.isModalSubmit() && interaction.customId.startsWith('hermesedit:')) {
        await handleProposalEditModal(interaction, sentinel);
      }
    } catch (e: any) {
      console.error('interaction error:', e?.message ?? e);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleThreadMessage(message, sentinel);
    } catch (e: any) {
      console.error('message error:', e?.message ?? e);
    }
  });

  await client.login(cfg.discordToken);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
