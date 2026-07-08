// One-shot: register the guild slash commands with Discord. Run with
// `npm run register` after setting DISCORD_BOT_TOKEN / DISCORD_CLIENT_ID /
// DISCORD_GUILD_ID. Guild commands appear instantly (global ones take ~1h).

import { REST, Routes } from 'discord.js';
import { loadConfig } from './config.js';
import { commands } from './commands.js';

async function main() {
  const cfg = await loadConfig();
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  console.log(`Registering ${commands.length} command(s) to guild ${cfg.guildId}…`);
  await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), {
    body: commands,
  });
  console.log('Done.');
}

main().catch((e) => {
  console.error('register failed:', e);
  process.exit(1);
});
