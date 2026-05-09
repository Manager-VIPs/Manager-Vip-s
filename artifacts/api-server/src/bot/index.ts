import { Events } from "discord.js";
import { discordClient } from "./client";
import { registerCommands, handleInteraction, expireVipMembers } from "./commands";
import { logger } from "../lib/logger";

const CHECK_INTERVAL_MS = 60 * 1000;

export async function startBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is not set — bot will not start");
    return;
  }

  discordClient.once(Events.ClientReady, async (client) => {
    logger.info({ tag: client.user.tag }, "Discord bot ready");
    await registerCommands();

    await expireVipMembers();
    setInterval(async () => {
      await expireVipMembers();
    }, CHECK_INTERVAL_MS);
  });

  discordClient.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleInteraction(interaction);
    } catch (err) {
      logger.error({ err }, "Error handling interaction");
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("An error occurred. Please try again.").catch(() => null);
      } else {
        await interaction.reply({ content: "An error occurred.", ephemeral: true }).catch(() => null);
      }
    }
  });

  discordClient.on(Events.Error, (err) => {
    logger.error({ err }, "Discord client error");
  });

  await discordClient.login(token);
}
