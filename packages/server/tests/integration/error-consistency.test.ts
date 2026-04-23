import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "../api/test-helpers.js";

/**
 * Task 3.5 — Error response consistency.
 *
 * Every 4xx/5xx response from the API must carry a JSON body of shape
 * `{ error: string }`. 2xx responses may use any shape (per I7 in the
 * plan). This test injects bad/missing input across a representative
 * sample of routes and verifies the contract.
 */

interface ErrorBody { error?: unknown }

describe("Error response consistency", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  // ──────────────── Unauthenticated ────────────────

  const unauth: Array<{ method: "get" | "post" | "put" | "delete"; url: string; label: string }> = [
    { method: "get", url: "/api/game/status", label: "GET /api/game/status (no auth)" },
    { method: "get", url: "/api/game/party", label: "GET /api/game/party (no auth)" },
    { method: "get", url: "/api/user/profile", label: "GET /api/user/profile (no auth)" },
    { method: "post", url: "/api/tower/start", label: "POST /api/tower/start (no auth)" },
    { method: "get", url: "/api/tower/status", label: "GET /api/tower/status (no auth)" },
  ];

  for (const tc of unauth) {
    it(`${tc.label} returns 401 with { error: string }`, async () => {
      const req = t.request[tc.method](tc.url);
      const res = await (tc.method === "get" ? req : req.send({}));
      expect(res.status).toBe(401);
      const body = res.body as ErrorBody;
      expect(typeof body.error).toBe("string");
      expect((body.error as string).length).toBeGreaterThan(0);
    });
  }

  // ──────────────── Validation / bad body ────────────────

  it("POST /api/auth/register with empty body → 400 {error}", async () => {
    const res = await t.request.post("/api/auth/register").send({});
    expect(res.status).toBe(400);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });

  it("POST /api/auth/register with bad starter → 400 {error}", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "badstarter",
      password: "testpass123",
      nickname: "t",
      starter: "mewtwo",
    });
    expect(res.status).toBe(400);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });

  it("POST /api/auth/register with non-alphanumeric id → 400 {error}", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "bad id!",
      password: "testpass123",
      nickname: "t",
      starter: "charmander",
    });
    expect(res.status).toBe(400);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });

  it("POST /api/auth/login with missing fields → 400 {error}", async () => {
    const res = await t.request.post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });

  it("POST /api/auth/login with unknown user → 401 {error}", async () => {
    const res = await t.request.post("/api/auth/login").send({
      id: "unknown_user_xyz_42",
      password: "anything",
    });
    expect(res.status).toBe(401);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });

  // ──────────────── Unknown resources ────────────────

  it("GET /api/moves/:id with unknown move → 404 {error}", async () => {
    const res = await t.request.get("/api/moves/this-move-does-not-exist-xyz");
    expect(res.status).toBe(404);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });

  it("GET /api/user/judge/:uid with unknown uid → 4xx {error}", async () => {
    const { token } = await t.registerAndLogin("errjudge", "charmander");
    const api = t.authed(token);
    const res = await api.get("/api/user/judge/not-a-real-uid");
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });

  // ──────────────── Admin gating ────────────────

  it("POST /api/admin/repo without admin key → 403 {error}", async () => {
    const res = await t.request.post("/api/admin/repo").send({ url: "foo" });
    expect([401, 403]).toContain(res.status);
    const body = res.body as ErrorBody;
    expect(typeof body.error).toBe("string");
  });
});
