import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createRateLimiter,
  isRateLimitDisabled,
} from "../../src/middleware/rate-limit-middleware.js";

/**
 * 한도 미들웨어는 테스트 환경에서 비활성화되므로(VITEST==='true'),
 * 실제 한도 동작을 검증하려면 비활성화 플래그를 일시적으로 끈다.
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
    if (saved.disable === undefined) {
      delete process.env.POKELOG_DISABLE_RATE_LIMIT;
    } else {
      process.env.POKELOG_DISABLE_RATE_LIMIT = saved.disable;
    }
  }
}

async function listen(app: express.Express): Promise<{ baseUrl: string; close: () => void }> {
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
  };
}

describe("isRateLimitDisabled", () => {
  it("is disabled under vitest", () => {
    expect(process.env.VITEST).toBe("true");
    expect(isRateLimitDisabled()).toBe(true);
  });

  it("respects the explicit disable flag toggle", () => {
    withRateLimitEnabled(() => {
      expect(isRateLimitDisabled()).toBe(false);
    });
  });
});

describe("createRateLimiter", () => {
  let close: (() => void) | null = null;

  beforeEach(() => {
    close = null;
  });

  afterEach(() => {
    close?.();
  });

  it("passes every request through while disabled (test env)", async () => {
    const app = express();
    app.use("/ping", createRateLimiter(2));
    app.get("/ping", (_req, res) => res.json({ ok: true }));

    const handle = await listen(app);
    close = handle.close;

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${handle.baseUrl}/ping`);
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 after the limit when enabled", async () => {
    const limiter = withRateLimitEnabled(() => createRateLimiter(2));

    const app = express();
    app.use("/ping", (req, res, next) =>
      withRateLimitEnabled(() => limiter(req, res, next)),
    );
    app.get("/ping", (_req, res) => res.json({ ok: true }));

    const handle = await listen(app);
    close = handle.close;

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${handle.baseUrl}/ping`);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses[2]).toBe(429);
    expect(statuses[3]).toBe(429);
  });
});
