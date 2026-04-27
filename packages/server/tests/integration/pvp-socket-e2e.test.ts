import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as SocketServer } from "socket.io";
import { io as ioClient } from "socket.io-client";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Task 3.2 — Socket.IO end-to-end integration.
 *
 * Boots an in-process HTTP + Socket.IO server, wires up setupPvpSocket,
 * connects a real socket.io-client, and walks the auth → AI battle
 * handshake end-to-end. Uses AI battle (single user) rather than
 * matchmaking to avoid orchestrating two parallel authenticated clients
 * and their storage setup; the auth/queue/room state paths exercise the
 * same socket plumbing.
 */

describe.sequential("PvP Socket.IO E2E", () => {
  let httpServer: HttpServer;
  let ioServer: SocketServer;
  let port: number;
  let dataDir: string;
  let token: string;

  beforeAll(async () => {
    // Isolate data directory for this test.
    dataDir = path.join(os.tmpdir(), `pokelog-pvp-e2e-${randomUUID()}`);
    fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        meta: { name: "PvP E2E", region: "kanto", featureFlags: { pvp: true } },
        polling: { intervalMinutes: 5 },
        rewards: {
          expPerByte: 0.01,
          pointsPerByte: 0.005,
          encounter: { baseChance: 0.3, ceilingBytes: 1000, timeLimitHours: 168 },
        },
      }),
    );
    process.env.POKELOG_DATA_DIR = dataDir;

    const { createApp } = await import("../../src/app.js");
    const { setupPvpSocket } = await import("../../src/pvp/pvp-socket.js");
    const { issueToken } = await import("../../src/auth/auth.js");
    const { saveUser } = await import("../../src/storage/user-store.js");
    const { createPokemon } = await import("../../src/game/pokemon-factory.js");

    const app = createApp();
    httpServer = createHttpServer(app);
    ioServer = new SocketServer(httpServer, { cors: { origin: "*" } });
    setupPvpSocket(ioServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (httpServer.address() as AddressInfo).port;

    // Create a user with a 3-mon party so ai_battle can spin up a room.
    const userId = "pvpe2euser";
    const party = [
      createPokemon("pikachu", 50),
      createPokemon("charizard", 50),
      createPokemon("blastoise", 50),
    ];
    await saveUser({
      account: {
        id: userId,
        password: "x",
        nickname: "PvP E2E User",
        createdAt: new Date().toISOString(),
        matchings: {},
      },
      currentRegion: "default",
      points: 0,
      totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
      encounterCeiling: { accumulatedBytes: 0 },
      party: party.map((p) => p.uid),
      pokemon: party,
      eggs: [],
      pokedex: ["pikachu", "charizard", "blastoise"],
      inventory: { pokeball: 5 },
      pendingEvents: [],
      pendingEvolutions: [],
      battleState: null,
      storage: [],
      log: [],
      integrations: [],
    });

    token = issueToken(userId);
  });

  afterAll(async () => {
    ioServer?.close();
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    try {
      const { awaitPendingPvpWork } = await import("../../src/pvp/pvp-socket.js");
      await awaitPendingPvpWork();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.POKELOG_DATA_DIR;
  });

  it("authenticates, starts AI battle, and receives room_state", async () => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      autoConnect: false,
      transports: ["websocket"],
      forceNew: true,
    });

    try {
      // Connect
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("connect_error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        socket.connect();
      });
      expect(socket.connected).toBe(true);

      // Authenticate
      const authed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("auth timeout")), 5000);
        socket.once("pvp:authenticated", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("pvp:error", (e) => {
          clearTimeout(timer);
          reject(new Error((e as { message: string }).message));
        });
      });
      socket.emit("pvp:auth", { token });
      await authed;

      // Start AI battle and listen for the matched + room_state events
      const matched = new Promise<{ roomId: string; opponent: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("match timeout")), 10000);
        socket.once("pvp:matched", (data) => {
          clearTimeout(timer);
          resolve(data as { roomId: string; opponent: string });
        });
      });
      const roomState = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("room_state timeout")), 10000);
        socket.once("pvp:room_state", (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
      socket.emit("pvp:ai_battle");

      const [matchData, stateData] = await Promise.all([matched, roomState]);
      expect(matchData.roomId).toBeDefined();
      expect(matchData.opponent).toBe("AI 트레이너");
      expect(stateData).toBeDefined();
      const state = stateData as { me?: unknown; opponent?: unknown };
      expect(state.me).toBeDefined();
      expect(state.opponent).toBeDefined();
    } finally {
      socket.disconnect();
    }
  }, 20000);

  it("rejects invalid JWT on pvp:auth", async () => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      autoConnect: false,
      transports: ["websocket"],
      forceNew: true,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.connect();
      });

      const errored = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("expected pvp:error")), 5000);
        socket.once("pvp:error", (e) => {
          clearTimeout(timer);
          resolve((e as { message: string }).message);
        });
        socket.once("pvp:authenticated", () => {
          clearTimeout(timer);
          reject(new Error("should not authenticate with bad token"));
        });
      });
      socket.emit("pvp:auth", { token: "not.a.real.jwt" });
      const msg = await errored;
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    } finally {
      socket.disconnect();
    }
  }, 10000);
});
