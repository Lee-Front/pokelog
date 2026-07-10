import { createApp } from "./app.js";
import { getConfig } from "./storage/config-store.js";
import { startPolling } from "./polling/polling-worker.js";
import { startAutoSearch } from "./polling/auto-search-worker.js";
import { logger } from "./logger.js";

if (!process.env.POKELOG_JWT_SECRET) {
  logger.fatal("POKELOG_JWT_SECRET environment variable is required");
  process.exit(1);
}

async function main() {
  const config = await getConfig();
  const app = createApp();

  app.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, "pokelog server running");
    startPolling();
    startAutoSearch();
  });
}

main().catch((err) => {
  logger.fatal({ err }, "server failed to start");
  process.exit(1);
});
