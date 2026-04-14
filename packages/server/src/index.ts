import { createApp } from "./app.js";
import { getConfig } from "./storage/config-store.js";
import { startPolling } from "./polling/polling-worker.js";

if (!process.env.POKELOG_JWT_SECRET) {
  console.error("FATAL: POKELOG_JWT_SECRET environment variable is required");
  process.exit(1);
}

async function main() {
  const config = await getConfig();
  const app = createApp();

  app.listen(config.server.port, () => {
    console.log(`pokelog server running on port ${config.server.port}`);
    startPolling();
  });
}

main().catch(console.error);
