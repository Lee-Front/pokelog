import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { createApp } from "./app.js";
import { getConfig } from "./storage/config-store.js";
import { startPolling } from "./polling/polling-worker.js";
import { setupPvpSocket } from "./pvp/pvp-socket.js";

if (!process.env.POKELOG_JWT_SECRET) {
  console.error("FATAL: POKELOG_JWT_SECRET environment variable is required");
  process.exit(1);
}

async function main() {
  const config = await getConfig();
  const app = createApp();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: "*" } });

  if (config.meta.featureFlags.pvp !== false) {
    setupPvpSocket(io);
  }

  httpServer.listen(config.server.port, () => {
    console.log(`pokelog server running on port ${config.server.port}`);
    startPolling();
  });
}

main().catch(console.error);
