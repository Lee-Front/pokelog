/**
 * API 통합 테스트 헬퍼
 *
 * 각 테스트 스위트에서 사용:
 *   const { app, registerAndLogin, cleanup } = await setupTestApp();
 */
import { vi } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import supertest from "supertest";

// POKELOG_JWT_SECRET은 vitest globalSetup(tests/global-setup.ts)에서 설정됨

export async function setupTestApp() {
  // 테스트마다 격리된 임시 데이터 디렉토리
  const dataDir = path.join(os.tmpdir(), `pokelog-test-${randomUUID()}`);
  fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "trades"), { recursive: true });

  // config.json 기본값 생성
  fs.writeFileSync(
    path.join(dataDir, "config.json"),
    JSON.stringify({
      meta: { name: "Test Server", region: "kanto" },
      polling: { intervalMinutes: 5 },
      rewards: {
        expPerByte: 0.01,
        pointsPerByte: 0.005,
        encounter: { baseChance: 0.3, ceilingBytes: 1000, timeLimitHours: 168 },
      },
    }),
  );

  process.env.POKELOG_DATA_DIR = dataDir;
  process.env.POKELOG_ADMIN_KEY = "test-admin-key";

  // 캐시 초기화 (이전 테스트 데이터 오염 방지)
  vi.resetModules();
  const { clearAllCaches } = await import("../../src/game/data-loader.js");
  clearAllCaches();

  const { createApp } = await import("../../src/app.js");
  const app = createApp();
  const request = supertest(app);

  async function registerAndLogin(
    id?: string,
    starter?: string,
  ): Promise<{ token: string; userId: string }> {
    const userId = id ?? `user${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const res = await request.post("/api/auth/register").send({
      id: userId,
      password: "testpass123",
      nickname: userId,
      starter: starter ?? "charmander",
    });

    if (res.status !== 201) {
      throw new Error(`Register failed: ${res.status} ${JSON.stringify(res.body)}`);
    }

    return { token: res.body.token, userId };
  }

  function authed(token: string) {
    return {
      get: (url: string) => request.get(url).set("Authorization", `Bearer ${token}`),
      post: (url: string, body?: Record<string, unknown>) => {
        const req = request.post(url).set("Authorization", `Bearer ${token}`);
        return body ? req.send(body) : req.send();
      },
      put: (url: string, body?: Record<string, unknown>) => {
        const req = request.put(url).set("Authorization", `Bearer ${token}`);
        return body ? req.send(body) : req.send();
      },
    };
  }

  function admin() {
    return {
      get: (url: string) => request.get(url).set("x-admin-key", "test-admin-key"),
      post: (url: string, body?: Record<string, unknown>) => {
        const req = request.post(url).set("x-admin-key", "test-admin-key");
        return body ? req.send(body) : req.send();
      },
    };
  }

  function cleanup() {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    delete process.env.POKELOG_DATA_DIR;
    delete process.env.POKELOG_ADMIN_KEY;
  }

  return { app, request, registerAndLogin, authed, admin, cleanup, dataDir };
}

export type TestApp = Awaited<ReturnType<typeof setupTestApp>>;
