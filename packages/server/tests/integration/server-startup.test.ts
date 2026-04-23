import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Task 3.1 — in-process server startup smoke test.
 *
 * Boots the Express app via createApp() + app.listen(0). Verifies the
 * server actually binds to a random port and that known endpoints respond
 * (i.e. routes are wired, middleware works). Avoids spawning a child
 * process (CI-flaky).
 */

describe("Server startup (in-process)", () => {
  let server: Server;
  let baseUrl: string;
  let dataDir: string;
  let startElapsed = 0;

  beforeAll(async () => {
    // Isolated data dir so this test doesn't touch real user files.
    dataDir = path.join(os.tmpdir(), `pokelog-startup-${randomUUID()}`);
    fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        meta: { name: "Startup Test", region: "kanto" },
        polling: { intervalMinutes: 5 },
        rewards: {
          expPerByte: 0.01,
          pointsPerByte: 0.005,
          encounter: { baseChance: 0.3, ceilingBytes: 1000, timeLimitHours: 168 },
        },
      }),
    );
    process.env.POKELOG_DATA_DIR = dataDir;

    const start = Date.now();
    const { createApp } = await import("../../src/app.js");
    const app = createApp();
    server = await new Promise<Server>((resolve) => {
      const inst = app.listen(0, "127.0.0.1", () => resolve(inst));
    });
    startElapsed = Date.now() - start;
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.POKELOG_DATA_DIR;
  });

  it("boots within a reasonable budget (< 10s)", () => {
    expect(startElapsed).toBeLessThan(10_000);
  });

  it("binds to a random port", () => {
    const addr = server.address() as AddressInfo;
    expect(addr.port).toBeGreaterThan(0);
  });

  it("responds to GET /api/meta without authentication", async () => {
    const res = await fetch(`${baseUrl}/api/meta`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it("responds to GET /api/moves/catalog without authentication", async () => {
    const res = await fetch(`${baseUrl}/api/moves/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { moves: unknown[] };
    expect(Array.isArray(body.moves)).toBe(true);
    expect(body.moves.length).toBeGreaterThan(0);
  });

  it("rejects unauthenticated access to protected endpoint with 401", async () => {
    const res = await fetch(`${baseUrl}/api/game/status`);
    expect(res.status).toBe(401);
  });

  it("register endpoint returns 400 on empty body (not 404)", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(typeof body.error).toBe("string");
  });
});
