/**
 * In-process test server boot helper for AI playtest scenarios.
 *
 * Each call to startTestServer():
 *  - Creates an isolated tmp data directory and points POKELOG_DATA_DIR at it
 *  - Resets the in-memory user index so it doesn't leak entries from a
 *    previous run that pointed at a different data directory
 *  - Boots createApp() over a Node http.Server bound to a random port
 *  - Wires up Socket.IO with setupPvpSocket so PvP scenarios can attach
 *
 * Tests should always pair startTestServer with stopTestServer to release
 * the server handle, the Socket.IO server, and the tmp data directory.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Server as SocketServer } from "socket.io";
import type { Express } from "express";

export interface TestContext {
  app: Express;
  httpServer: Server;
  ioServer: SocketServer;
  port: number;
  baseUrl: string;
  /** Tmp directory used as POKELOG_DATA_DIR for this test run. */
  dataDir: string;
}

/**
 * Sensible defaults for the test environment. We set these eagerly here
 * (rather than only in setup.ts) so that scenario authors who forget to
 * import the setup file still get a working server.
 */
function ensureEnvDefaults(): void {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.POKELOG_ENABLE_ADMIN_TEST = process.env.POKELOG_ENABLE_ADMIN_TEST ?? "1";
  process.env.POKELOG_JWT_SECRET = process.env.POKELOG_JWT_SECRET ?? "playtest-secret";
  process.env.POKELOG_ADMIN_KEY = process.env.POKELOG_ADMIN_KEY ?? "test-admin-key";
}

export async function startTestServer(): Promise<TestContext> {
  ensureEnvDefaults();

  // Per-run isolated data directory. Mirrors the pattern used by
  // tests/api/test-helpers.ts and tests/integration/pvp-socket-e2e.test.ts.
  const dataDir = path.join(os.tmpdir(), `pokelog-playtest-${randomUUID()}`);
  fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "trades"), { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "config.json"),
    JSON.stringify({
      meta: { name: "Playtest Server", region: "kanto", featureFlags: { pvp: true } },
      polling: { intervalMinutes: 5 },
      rewards: {
        expPerByte: 0.01,
        pointsPerByte: 0.005,
        encounter: { baseChance: 0.3, ceilingBytes: 1000, timeLimitHours: 168 },
      },
    }),
  );
  process.env.POKELOG_DATA_DIR = dataDir;

  // Reset the in-memory user index so the previous test's tmp dir doesn't
  // leak into ours.
  const userStore = await import("../../src/storage/user-store.js");
  userStore._resetUserIndex();

  // Lazy-import after env is configured so the modules pick up our settings.
  const { createApp } = await import("../../src/app.js");
  const { setupPvpSocket } = await import("../../src/pvp/pvp-socket.js");

  const app = createApp();
  const httpServer = createServer(app);
  const ioServer = new SocketServer(httpServer, { cors: { origin: "*" } });
  setupPvpSocket(ioServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Failed to bind playtest server");
  }
  const port = address.port;
  return {
    app,
    httpServer,
    ioServer,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
  };
}

export async function stopTestServer(ctx: TestContext): Promise<void> {
  try {
    ctx.ioServer.close();
  } catch {
    // ignore
  }
  await new Promise<void>((resolve) => {
    ctx.httpServer.close(() => resolve());
  });
  try {
    fs.rmSync(ctx.dataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
  // Don't unset POKELOG_DATA_DIR — a sibling test starting in parallel would
  // otherwise see a brief window where it points at a deleted dir. Vitest
  // runs files non-parallel for this package, so leaving the env var alone
  // is harmless; the next startTestServer will overwrite it.
}
