/**
 * Scenario 24 — Data Persistence.
 *
 * "Restart" semantics: stop the in-process server, then start a new one
 * pointing at the SAME data dir. Verify:
 *  - User account, points, party, pokedex all reload
 *  - In-flight trade record persists (it lives on disk)
 *  - PvP rooms are volatile (Map in memory) — restart drops them
 *  - Tower run mid-progress (active run on user) persists
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import {
  startTestServer, stopTestServer, type TestContext,
} from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import { createTradeRequest } from "../../src/game/trade.js";
import { createRoom } from "../../src/pvp/pvp-room.js";
import { startTower } from "../../src/game/tower.js";
import { saveUser, getUser } from "../../src/storage/user-store.js";
import { Server as SocketServer } from "socket.io";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import type { Express } from "express";
import type { Server } from "node:http";

interface SimpleCtx {
  app: Express;
  httpServer: Server;
  ioServer: SocketServer;
  port: number;
  baseUrl: string;
  dataDir: string;
}

/**
 * Re-bind a fresh app + Socket.IO server against an existing data dir.
 * Equivalent to startTestServer but doesn't create a new tmp directory —
 * lets us simulate a server restart against the same on-disk state.
 */
async function startBoundTo(dataDir: string): Promise<SimpleCtx> {
  process.env.POKELOG_DATA_DIR = dataDir;
  const userStore = await import("../../src/storage/user-store.js");
  userStore._resetUserIndex();

  const { createApp } = await import("../../src/app.js");
  const { setupPvpSocket } = await import("../../src/pvp/pvp-socket.js");

  const app = createApp();
  const httpServer = createHttpServer(app);
  const ioServer = new SocketServer(httpServer, { cors: { origin: "*" } });
  setupPvpSocket(ioServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (httpServer.address() as AddressInfo).port;
  return { app, httpServer, ioServer, port, baseUrl: `http://127.0.0.1:${port}`, dataDir };
}

async function stopBound(ctx: SimpleCtx, removeDir = false): Promise<void> {
  try { ctx.ioServer.close(); } catch { /* ignore */ }
  await new Promise<void>((resolve) => ctx.httpServer.close(() => resolve()));
  if (removeDir) {
    try { fs.rmSync(ctx.dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

describe("Scenario 24 — Data Persistence", () => {
  let firstCtx: TestContext;
  let dataDir: string;

  beforeAll(async () => {
    firstCtx = await startTestServer();
    dataDir = firstCtx.dataDir;
  });

  afterAll(async () => {
    // The first server is already stopped by tests below; only clean
    // the dataDir.
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("user state survives a server restart", async () => {
    const { user, token } = await createTestUser({
      uid: "persistUser1",
      initialPoints: 7777,
      initialPokemon: [{ species: "pikachu", level: 25 }],
    });
    const http1 = new HttpClient(firstCtx.app, token);
    const before = await http1.get("/api/user/profile");
    expect(before.status).toBe(200);
    expect(before.body.points).toBe(7777);

    // Simulate a restart: close server 1, boot server 2 against same dir.
    await stopBound({ ...firstCtx, dataDir }, false);
    const ctx2 = await startBoundTo(dataDir);
    try {
      const http2 = new HttpClient(ctx2.app, token);
      const after = await http2.get("/api/user/profile");
      expect(after.status).toBe(200);
      expect(after.body.account.id).toBe(user.account.id);
      expect(after.body.points).toBe(7777);
      expect(after.body.pokemon[0].species).toBe("pikachu");
    } finally {
      await stopBound(ctx2, false);
    }
    // Re-open the firstCtx for any subsequent test bodies that need it.
    const ctx3 = await startBoundTo(dataDir);
    firstCtx.app = ctx3.app;
    firstCtx.httpServer = ctx3.httpServer;
    firstCtx.ioServer = ctx3.ioServer;
    firstCtx.port = ctx3.port;
    firstCtx.baseUrl = ctx3.baseUrl;
  });

  it("in-flight trade record persists through a restart", async () => {
    await createTestUser({
      uid: "persistTradeA",
      initialPokemon: [{ species: "machoke", level: 25 }],
    });
    const B = await createTestUser({
      uid: "persistTradeB",
      initialPokemon: [{ species: "haunter", level: 25 }],
    });
    const A2 = await getUser("persistTradeA");
    const trade = await createTradeRequest({
      requesterUserId: "persistTradeA",
      responderUserId: "persistTradeB",
      requesterPokemonUid: A2!.pokemon[0].uid,
      responderPokemonUid: B.user.pokemon[0].uid,
    });
    expect(trade.status).toBe("pending");

    await stopBound({ ...firstCtx, dataDir }, false);
    const ctx2 = await startBoundTo(dataDir);
    try {
      const { getTrades } = await import("../../src/storage/trade-store.js");
      const trades = await getTrades();
      const found = trades.find((t) => t.id === trade.id);
      expect(found).toBeDefined();
      expect(found?.status).toBe("pending");
    } finally {
      await stopBound(ctx2, false);
    }
    const ctx3 = await startBoundTo(dataDir);
    firstCtx.app = ctx3.app;
    firstCtx.httpServer = ctx3.httpServer;
    firstCtx.ioServer = ctx3.ioServer;
    firstCtx.port = ctx3.port;
    firstCtx.baseUrl = ctx3.baseUrl;
  });

  it("PvP rooms have NO disk presence — they live entirely in memory", async () => {
    // Create a room and verify nothing is written for it. We don't
    // actually restart the node process (vitest keeps it alive), so
    // testing "the room map is gone" requires a true new process —
    // instead we assert the weaker but correct property that no disk
    // file backs the room map. If the implementation ever changed to
    // persist rooms, this test would fail and force a re-evaluation.
    const room = createRoom(
      "roomVolA", "A", [], "roomVolB", "B", [], false,
    );
    const { getRoom } = await import("../../src/pvp/pvp-room.js");
    expect(getRoom(room.roomId)).toBeDefined();

    const files = fs.readdirSync(dataDir);
    expect(files.some((f) => f.toLowerCase().includes("pvp-room"))).toBe(false);
  });

  it("active tower run survives a restart", async () => {
    const { user } = await createTestUser({
      uid: "persistTower",
      initialPokemon: [
        { species: "pikachu", level: 30 },
        { species: "blastoise", level: 30 },
        { species: "venusaur", level: 30 },
      ],
    });
    const partyUids = user.pokemon.map((p) => p.uid);
    const result = startTower(user, partyUids);
    expect(result.ok).toBe(true);
    user.activeTowerRun = result.run;
    await saveUser(user);

    await stopBound({ ...firstCtx, dataDir }, false);
    const ctx2 = await startBoundTo(dataDir);
    try {
      const reloaded = await getUser("persistTower");
      expect(reloaded?.activeTowerRun).toBeDefined();
      expect(reloaded?.activeTowerRun?.stage).toBe(1);
      expect(reloaded?.activeTowerRun?.partyUids).toEqual(partyUids);
    } finally {
      await stopBound(ctx2, false);
    }
    const ctx3 = await startBoundTo(dataDir);
    firstCtx.app = ctx3.app;
    firstCtx.httpServer = ctx3.httpServer;
    firstCtx.ioServer = ctx3.ioServer;
    firstCtx.port = ctx3.port;
    firstCtx.baseUrl = ctx3.baseUrl;
  });
});
