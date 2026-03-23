import { createApp } from "./app.js";
import { getConfig } from "./storage/config-store.js";
import { startPolling } from "./polling/polling-worker.js";

async function main() {
  const config = await getConfig();
  const app = createApp();

  app.listen(config.server.port, () => {
    console.log(`pokelog server running on port ${config.server.port}`);
    startPolling();
  });
}

main().catch(console.error);
