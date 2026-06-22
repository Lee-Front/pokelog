/**
 * API 통합 테스트 헬퍼
 *
 * 각 테스트 스위트에서 사용:
 *   const { app, registerAndLogin, cleanup } = await setupTestApp();
 */
import { vi } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import os from "node:os";
import type { Server } from "node:http";

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
        encounter: { rollCount: 12 },
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
  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Failed to bind test server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  type TestResponse = {
    status: number;
    body: unknown;
    text: string;
    headers: Headers;
  };

  type RequestBuilder = {
    set: (name: string, value: string) => RequestBuilder;
    send: (body?: Record<string, unknown>) => Promise<TestResponse>;
    then: Promise<TestResponse>["then"];
  };

  function createRequestBuilder(
    method: string,
    url: string,
    defaultHeaders: Record<string, string> = {},
  ): RequestBuilder {
    const headers = new Headers(defaultHeaders);

    const execute = async (body?: Record<string, unknown>): Promise<TestResponse> => {
      const init: RequestInit = {
        method,
        headers,
      };

      if (body !== undefined) {
        headers.set("content-type", "application/json");
        init.body = JSON.stringify(body);
      }

      const response = await fetch(`${baseUrl}${url}`, init);
      const text = await response.text();
      let parsed: unknown = undefined;

      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }

      return {
        status: response.status,
        body: parsed,
        text,
        headers: response.headers,
      };
    };

    return {
      set(name: string, value: string) {
        headers.set(name, value);
        return this;
      },
      send(body?: Record<string, unknown>) {
        return execute(body);
      },
      then(onfulfilled, onrejected) {
        return execute().then(onfulfilled, onrejected);
      },
    };
  }

  function createClient(defaultHeaders: Record<string, string> = {}) {
    return {
      get: (url: string) => createRequestBuilder("GET", url, defaultHeaders),
      post: (url: string) => createRequestBuilder("POST", url, defaultHeaders),
      put: (url: string) => createRequestBuilder("PUT", url, defaultHeaders),
      patch: (url: string) => createRequestBuilder("PATCH", url, defaultHeaders),
      delete: (url: string) => createRequestBuilder("DELETE", url, defaultHeaders),
    };
  }

  const request = createClient();

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
    const client = createClient({ Authorization: `Bearer ${token}` });
    return {
      get: (url: string) => client.get(url),
      post: (url: string, body?: Record<string, unknown>) => {
        const req = client.post(url);
        return body ? req.send(body) : req.send();
      },
      put: (url: string, body?: Record<string, unknown>) => {
        const req = client.put(url);
        return body ? req.send(body) : req.send();
      },
      delete: (url: string, body?: Record<string, unknown>) => {
        const req = client.delete(url);
        return body ? req.send(body) : req.send();
      },
    };
  }

  function admin() {
    const client = createClient({ "x-admin-key": "test-admin-key" });
    return {
      get: (url: string) => client.get(url),
      post: (url: string, body?: Record<string, unknown>) => {
        const req = client.post(url);
        return body ? req.send(body) : req.send();
      },
      put: (url: string, body?: Record<string, unknown>) => {
        const req = client.put(url);
        return body ? req.send(body) : req.send();
      },
      patch: (url: string, body?: Record<string, unknown>) => {
        const req = client.patch(url);
        return body ? req.send(body) : req.send();
      },
      delete: (url: string, body?: Record<string, unknown>) => {
        const req = client.delete(url);
        return body ? req.send(body) : req.send();
      },
    };
  }

  function cleanup() {
    try {
      server.close();
    } catch {
      // ignore server close errors
    }
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
