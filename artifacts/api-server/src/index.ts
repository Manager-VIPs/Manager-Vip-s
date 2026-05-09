import app from "./app";
import { logger } from "./lib/logger";
import { startBot, registerCommands } from "./bot";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/* ---------------- SERVER ---------------- */

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

/* ---------------- DISCORD BOT ---------------- */

async function bootstrapBot() {
  try {
    await startBot();
    logger.info("Discord bot started");

    // 🔥 FIX IMPORTANT: register slash commands AFTER bot is ready
    await registerCommands();
    logger.info("Slash commands registered");
  } catch (err) {
    logger.error({ err }, "Failed to start Discord bot");
  }
}

bootstrapBot();
