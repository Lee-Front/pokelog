import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Health endpoints exposed for orchestrators / load balancers. Both
 * endpoints must respond 200 with a JSON body and must not require
 * authentication — operators can't readily provision JWTs to a probe.
 */
describe("Health endpoints", () => {
  let server: Server;
  let baseUrl: string;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `pokelog-health-${randomUUID()}`);
    fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        meta: { name: "Health Test", region: "kanto" },
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
    const app = createApp();
    server = await new Promise<Server>((resolve) => {
      const inst = app.listen(0, "127.0.0.1", () => resolve(inst));
    });
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

  it("GET /healthz responds 200 with status, uptime, timestamp (no auth)", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe("string");
    // Timestamp is a parseable ISO string.
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("GET /api/health responds 200 with status, version, uptime (no auth)", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; version: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });

  it("health endpoints accept missing Authorization header without 401", async () => {
    const a = await fetch(`${baseUrl}/healthz`);
    const b = await fetch(`${baseUrl}/api/health`);
    expect(a.status).not.toBe(401);
    expect(b.status).not.toBe(401);
  });
});
