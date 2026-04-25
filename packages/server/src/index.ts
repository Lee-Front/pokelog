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

  // Socket.IO CORS policy.
  //
  // In production we refuse to allow "*" by default — cross-origin PvP
  // sockets carry an auth token and should only be hit from known
  // origins. Operators declare allowed origins via
  // POKELOG_SOCKET_CORS_ORIGINS (comma-separated).
  //
  // In development (NODE_ENV !== "production"), we fall back to "*" so
  // local CLIs, tests, and dev front-ends don't need extra config.
  const allowedOrigins = (process.env.POKELOG_SOCKET_CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && allowedOrigins.length === 0) {
    console.warn(
      "WARNING: running in production mode with no POKELOG_SOCKET_CORS_ORIGINS set. " +
      "Socket.IO CORS is locked down (no origins allowed). Set " +
      "POKELOG_SOCKET_CORS_ORIGINS to a comma-separated list of trusted origins.",
    );
  }

  const corsOrigin: string[] | boolean | string =
    allowedOrigins.length > 0
      ? allowedOrigins
      : (isProduction ? false : "*");

  const io = new SocketServer(httpServer, {
    cors: { origin: corsOrigin },
  });

  if (config.meta.featureFlags.pvp !== false) {
    setupPvpSocket(io);
  }

  httpServer.listen(config.server.port, () => {
    console.log(`pokelog server running on port ${config.server.port}`);
    startPolling();
  });

  // Graceful shutdown: drain in-flight HTTP requests + close the socket
  // server when the orchestrator sends SIGTERM/SIGINT. Without this the
  // process drops connections mid-flight on every redeploy.
  let isShuttingDown = false;
  function gracefulShutdown(signal: string): void {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[shutdown] received ${signal}, draining connections...`);

    io.close(() => console.log("[shutdown] socket.io closed"));

    httpServer.close((err) => {
      if (err) console.error("[shutdown] error:", err);
      console.log("[shutdown] http server closed");
      process.exit(0);
    });

    // Force exit if connections haven't drained in 10s. .unref() so the
    // timer itself doesn't hold the event loop open after close finishes.
    setTimeout(() => {
      console.error("[shutdown] timeout, forcing exit");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

main().catch(console.error);
