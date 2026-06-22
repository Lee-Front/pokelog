import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * CORS middleware behaviour. Each case boots an isolated app whose config.json
 * declares (or omits) corsAllowedOrigins, then inspects the CORS response
 * headers for preflight and actual requests.
 */

const ALLOWED = "https://portal.corp.example";
const DISALLOWED = "https://evil.example";

async function bootApp(corsAllowedOrigins?: string[]): Promise<{
  baseUrl: string;
  server: Server;
  dataDir: string;
}> {
  const dataDir = path.join(os.tmpdir(), `pokelog-cors-${randomUUID()}`);
  fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });

  const config: Record<string, unknown> = {
    meta: { name: "Test Server", region: "kanto" },
    polling: { intervalMinutes: 5 },
    rewards: {
      expPerByte: 0.01,
      pointsPerByte: 0.005,
      encounter: { rollCount: 12 },
    },
  };
  if (corsAllowedOrigins !== undefined) {
    config.server = { port: 3000, corsAllowedOrigins };
  }
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config));

  process.env.POKELOG_DATA_DIR = dataDir;
  vi.resetModules();
  const { clearAllCaches } = await import("../../src/game/data-loader.js");
  clearAllCaches();
  const { createApp } = await import("../../src/app.js");
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, dataDir };
}

let active: { server: Server; dataDir: string } | null = null;

afterEach(() => {
  if (active) {
    try { active.server.close(); } catch { /* ignore */ }
    try { fs.rmSync(active.dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    active = null;
  }
  delete process.env.POKELOG_DATA_DIR;
});

describe("CORS — allowlist configured", () => {
  let baseUrl: string;

  beforeEach(async () => {
    const booted = await bootApp([ALLOWED]);
    baseUrl = booted.baseUrl;
    active = booted;
  });

  it("echoes the origin and allows credentials for an allowed origin", async () => {
    const res = await fetch(`${baseUrl}/api/meta`, { headers: { Origin: ALLOWED } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("answers a preflight OPTIONS for an allowed origin", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    const allowMethods = res.headers.get("access-control-allow-methods") ?? "";
    expect(allowMethods).toContain("POST");
    const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowHeaders).toContain("authorization");
  });

  it("does not emit allow-origin for a disallowed origin", async () => {
    const res = await fetch(`${baseUrl}/api/meta`, { headers: { Origin: DISALLOWED } });
    // Request still succeeds server-side; the browser blocks it because no
    // matching CORS header is present.
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("ignores a trailing slash when matching the origin", async () => {
    const res = await fetch(`${baseUrl}/api/meta`, { headers: { Origin: `${ALLOWED}/` } });
    expect(res.headers.get("access-control-allow-origin")).toBe(`${ALLOWED}/`);
  });

  it("serves the /api/v1 alias identically", async () => {
    const v1 = await fetch(`${baseUrl}/api/v1/meta`, { headers: { Origin: ALLOWED } });
    expect(v1.status).toBe(200);
    expect(v1.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    const body = (await v1.json()) as { serverId?: string };
    expect(body).toHaveProperty("serverName");
  });
});

describe("CORS — allowlist empty/unset (disabled)", () => {
  it("emits no CORS headers when corsAllowedOrigins is an empty array", async () => {
    const booted = await bootApp([]);
    active = booted;
    const res = await fetch(`${booted.baseUrl}/api/meta`, { headers: { Origin: ALLOWED } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("emits no CORS headers when the server config omits the field", async () => {
    const booted = await bootApp(undefined);
    active = booted;
    const res = await fetch(`${booted.baseUrl}/api/meta`, { headers: { Origin: ALLOWED } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
