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

  // 포트는 PORT env가 있으면 그것을(blue-green 색깔별 포트 주입용), 없으면 config.server.port(기본 3000).
  // 두 색이 같은 pokelog-data/config.json을 공유하므로 색깔별 포트는 env로만 구분할 수 있다.
  const port = Number(process.env.PORT) || config.server.port;
  app.listen(port, () => {
    logger.info({ port }, "pokelog server running");
    startPolling();
    startAutoSearch();
  });
}

main().catch((err) => {
  logger.fatal({ err }, "server failed to start");
  process.exit(1);
});
