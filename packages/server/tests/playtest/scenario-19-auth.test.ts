/**
 * Scenario 19 — Auth / Session Cycle.
 *
 *  - Register a fresh account, login → JWT
 *  - Use JWT against an authed endpoint (200)
 *  - logout-all rotates the cutoff → previous JWT now 401
 *  - The successor token returned by /logout-all keeps working
 *  - Garbage / forged JWT also rejected with 401
 *  - Socket.IO mirrors the cutoff (pre-cutoff token gets pvp:error)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { HttpClient, createPvpClient } from "./api-helpers.js";
import { io as ioClient } from "socket.io-client";
import { issueToken } from "../../src/auth/auth.js";

describe("Scenario 19 — Auth / Session Cycle", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("register → login → use authed endpoint → logout-all rotates cutoff", async () => {
    const http = new HttpClient(ctx.app);
    const reg = await http.post("/api/auth/register", {
      id: "authuser1", password: "pw1234", nickname: "A1", starter: "bulbasaur",
    });
    expect(reg.status).toBe(201);
    const initialToken = reg.body.token as string;
    expect(initialToken.length).toBeGreaterThan(20);

    const login = await http.post("/api/auth/login", { id: "authuser1", password: "pw1234" });
    expect(login.status).toBe(200);
    const loginToken = login.body.token as string;

    http.setToken(loginToken);
    const profile = await http.get("/api/user/profile");
    expect(profile.status).toBe(200);
    expect(profile.body.account.id).toBe("authuser1");

    // logout-all rotates the cutoff. Stamp uses 1-second granularity, so we
    // must artificially backdate the existing token by issuing one with iat
    // floor(now/1000)-2 to guarantee it's strictly before the cutoff.
    const olderToken = issueToken("authuser1", Math.floor(Date.now() / 1000) - 2);

    const logoutAll = await http.post("/api/auth/logout-all");
    expect(logoutAll.status).toBe(200);
    expect(typeof logoutAll.body.token).toBe("string");
    const successor = logoutAll.body.token as string;

    // Old token (older than cutoff) → 401
    const stale = new HttpClient(ctx.app, olderToken);
    const staleRes = await stale.get("/api/user/profile");
    expect(staleRes.status).toBe(401);

    // New successor token → still works
    const fresh = new HttpClient(ctx.app, successor);
    const freshRes = await fresh.get("/api/user/profile");
    expect(freshRes.status).toBe(200);
  });

  it("invalid / malformed JWT is rejected with 401", async () => {
    const http = new HttpClient(ctx.app, "not.a.real.jwt");
    const res = await http.get("/api/user/profile");
    expect(res.status).toBe(401);
  });

  it("missing Authorization header → 401", async () => {
    const http = new HttpClient(ctx.app);
    const res = await http.get("/api/user/profile");
    expect(res.status).toBe(401);
  });

  it("Socket.IO rejects pre-cutoff token after logout-all", async () => {
    const http = new HttpClient(ctx.app);
    await http.post("/api/auth/register", {
      id: "authuser2", password: "pw1234", nickname: "A2", starter: "charmander",
    });
    // Issue a backdated token so it predates the imminent cutoff.
    const oldToken = issueToken("authuser2", Math.floor(Date.now() / 1000) - 2);
    const login = await http.post("/api/auth/login", { id: "authuser2", password: "pw1234" });
    http.setToken(login.body.token);

    await http.post("/api/auth/logout-all");

    // Try to authenticate the OLD token over Socket.IO → expect pvp:error.
    const socket = ioClient(ctx.baseUrl, {
      autoConnect: false,
      transports: ["websocket"],
      forceNew: true,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
        socket.once("connect", () => { clearTimeout(timer); resolve(); });
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
          reject(new Error("should not authenticate stale token"));
        });
      });
      socket.emit("pvp:auth", { token: oldToken });
      const msg = await errored;
      expect(msg).toMatch(/무효|인증/);
    } finally {
      socket.disconnect();
    }
  });

  it("successor token works for Socket.IO after logout-all", async () => {
    const http = new HttpClient(ctx.app);
    await http.post("/api/auth/register", {
      id: "authuser3", password: "pw1234", nickname: "A3", starter: "squirtle",
    });
    const login = await http.post("/api/auth/login", { id: "authuser3", password: "pw1234" });
    http.setToken(login.body.token);

    const logoutAll = await http.post("/api/auth/logout-all");
    const newToken = logoutAll.body.token as string;

    const client = await createPvpClient(ctx.baseUrl, newToken);
    try {
      // If we get here without throwing, auth succeeded.
      expect(client.socket.connected).toBe(true);
    } finally {
      client.close();
    }
  });
});
