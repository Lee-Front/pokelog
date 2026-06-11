import { describe, it, expect } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRateLimiter } from "../../src/middleware/rate-limit-middleware.js";

/**
 * Verifies the app's mounting strategy: a single rate limiter attached to the
 * FIRST `app.use("/api/game", limiter, router)` registration must also throttle
 * the SECONDARY routers mounted on the same `/api/game` prefix without their own
 * limiter (trade/egg/evolution/item/storage). This reproduces the exact wiring
 * in app.ts so a future refactor that breaks the fall-through is caught.
 */

function withRateLimitEnabled<T>(fn: () => T): T {
  const saved = {
    vitest: process.env.VITEST,
    nodeEnv: process.env.NODE_ENV,
    disable: process.env.POKELOG_DISABLE_RATE_LIMIT,
  };
  process.env.VITEST = "";
  process.env.NODE_ENV = "production";
  process.env.POKELOG_DISABLE_RATE_LIMIT = "0";
  try {
    return fn();
  } finally {
    process.env.VITEST = saved.vitest;
    process.env.NODE_ENV = saved.nodeEnv;
    if (saved.disable === undefined) delete process.env.POKELOG_DISABLE_RATE_LIMIT;
    else process.env.POKELOG_DISABLE_RATE_LIMIT = saved.disable;
  }
}

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => void }> {
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

describe("rate limiter applies to secondary /api/game routers", () => {
  it("throttles a route served by a router mounted after the limiter", async () => {
    const limiter = withRateLimitEnabled(() => createRateLimiter(2));

    // Mirror app.ts: primary game router carries the limiter, a secondary
    // router (mimicking tradeRoutes) is mounted on the same prefix without one.
    const primary = express.Router();
    primary.get("/status", (_req, res) => res.json({ ok: "status" }));
    const secondary = express.Router();
    secondary.get("/trades", (_req, res) => res.json({ ok: "trades" }));

    const app = express();
    app.use("/api/game", (req, res, next) => withRateLimitEnabled(() => limiter(req, res, next)), primary);
    app.use("/api/game", secondary);

    const handle = await listen(app);
    try {
      // Hit the SECONDARY router's route only; the limiter (max 2) lives on the
      // primary mount. If it does not fall through, these would all be 200.
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await fetch(`${handle.baseUrl}/api/game/trades`);
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 2)).toEqual([200, 200]);
      expect(statuses[2]).toBe(429);
      expect(statuses[3]).toBe(429);
    } finally {
      handle.close();
    }
  });

  it("429 body uses the project { error } shape", async () => {
    const limiter = withRateLimitEnabled(() => createRateLimiter(1));
    const app = express();
    app.use("/api/game", (req, res, next) => withRateLimitEnabled(() => limiter(req, res, next)));
    app.get("/api/game/x", (_req, res) => res.json({ ok: true }));

    const handle = await listen(app);
    try {
      await fetch(`${handle.baseUrl}/api/game/x`);
      const limited = await fetch(`${handle.baseUrl}/api/game/x`);
      expect(limited.status).toBe(429);
      const body = await limited.json();
      expect(typeof body.error).toBe("string");
    } finally {
      handle.close();
    }
  });
});
