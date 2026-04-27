import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { setupTestApp, type TestApp } from "../api/test-helpers.js";
import { issueToken, verifyToken } from "../../src/auth/auth.js";

/**
 * Task 3.6 — Security review.
 *
 * Covers:
 *   - JWT tampering / expiry / wrong-secret rejection.
 *   - Cross-user data access rejection (auth middleware routes on token).
 *   - Path-traversal / reserved-character userIds rejected at registration.
 *   - Admin endpoints gated by POKELOG_ADMIN_KEY (not by user JWT).
 */

describe("Security review", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  // ──────────────── JWT ────────────────

  it("tampered JWT signature is rejected", () => {
    const valid = issueToken("security_test_user");
    const tampered = valid.slice(0, -5) + "xxxxx";
    expect(verifyToken(tampered)).toBeNull();
  });

  it("garbage string is rejected", () => {
    expect(verifyToken("not.a.real.jwt")).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("aaaa")).toBeNull();
  });

  it("JWT signed with a wrong secret is rejected", () => {
    const bad = jwt.sign({ userId: "attacker" }, "wrong-secret-not-the-server-one", { expiresIn: "1h" });
    expect(verifyToken(bad)).toBeNull();
  });

  it("expired JWT is rejected", () => {
    // Sign a token that was valid 2 hours ago and only for 1 hour.
    const secret = process.env.POKELOG_JWT_SECRET!;
    const expired = jwt.sign({ userId: "expired_user" }, secret, {
      expiresIn: "-1h", // already expired
    });
    expect(verifyToken(expired)).toBeNull();
  });

  it("valid JWT returned from issueToken round-trips", () => {
    const tok = issueToken("roundtrip_user");
    const decoded = verifyToken(tok);
    expect(decoded?.userId).toBe("roundtrip_user");
  });

  // ──────────────── Protected endpoint access ────────────────

  it("unauthenticated request to protected endpoint is rejected (401)", async () => {
    const res = await t.request.get("/api/user/profile");
    expect(res.status).toBe(401);
  });

  it("malformed Authorization header is rejected (401)", async () => {
    const res = await t.request.get("/api/user/profile").set("Authorization", "Basic abc").send();
    expect(res.status).toBe(401);
  });

  it("bogus bearer token is rejected (401)", async () => {
    const res = await t.request.get("/api/user/profile")
      .set("Authorization", "Bearer fake.token.here")
      .send();
    expect(res.status).toBe(401);
  });

  // ──────────────── Registration input hardening ────────────────

  it("userId with path traversal (../) is rejected at registration", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "../../../etc/passwd",
      password: "testpass123",
      nickname: "attacker",
      starter: "charmander",
    });
    expect(res.status).toBe(400);
  });

  it("userId with forward slash is rejected at registration", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "some/user",
      password: "testpass123",
      nickname: "t",
      starter: "charmander",
    });
    expect(res.status).toBe(400);
  });

  it("userId with backslash is rejected at registration", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "some\\user",
      password: "testpass123",
      nickname: "t",
      starter: "charmander",
    });
    expect(res.status).toBe(400);
  });

  it("userId with null byte is rejected at registration", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "bad\u0000user",
      password: "testpass123",
      nickname: "t",
      starter: "charmander",
    });
    expect(res.status).toBe(400);
  });

  it("userId with unicode/emoji is rejected at registration (alphanumeric only)", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "유저1",
      password: "testpass123",
      nickname: "t",
      starter: "charmander",
    });
    expect(res.status).toBe(400);
  });

  // ──────────────── Admin gating ────────────────

  it("admin endpoint rejects requests without admin key (403)", async () => {
    const res = await t.request.post("/api/admin/repo").send({ url: "https://example.com/a" });
    expect([401, 403]).toContain(res.status);
  });

  it("admin endpoint rejects a regular user's JWT (403)", async () => {
    const { token } = await t.registerAndLogin("normaluser", "charmander");
    const res = await t.request.post("/api/admin/repo")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://example.com/a" });
    // Admin middleware doesn't check JWT — it only checks x-admin-key.
    // A JWT alone must NOT grant access.
    expect([401, 403]).toContain(res.status);
  });

  it("admin endpoint rejects wrong admin key (403)", async () => {
    const res = await t.request.post("/api/admin/repo")
      .set("x-admin-key", "wrong-key")
      .send({ url: "https://example.com/a" });
    expect(res.status).toBe(403);
  });

  // ──────────────── Cross-user data access ────────────────

  it("another user's JWT cannot read your pokemon (judge endpoint is self-scoped)", async () => {
    // userA registers, gets a pokemon uid
    const { token: tokenA } = await t.registerAndLogin("secusera", "charmander");
    const apiA = t.authed(tokenA);
    const partyA = await apiA.get("/api/game/party");
    const uidA = partyA.body.party[0].uid;

    // userB registers with their own token
    const { token: tokenB } = await t.registerAndLogin("secuserb", "squirtle");
    const apiB = t.authed(tokenB);

    // userB tries to judge userA's pokemon uid → server scopes by JWT
    // userId, so B must NOT find A's pokemon.
    const res = await apiB.get(`/api/user/judge/${uidA}`);
    expect(res.status).toBe(404);
  });

  // ──────────────── Prototype-pollution hardening ────────────────

  it("rejects /api/user/match with __proto__ as app key", async () => {
    const { token } = await t.registerAndLogin("matchproto", "charmander");
    const api = t.authed(token);
    const before = ({} as Record<string, unknown>).polluted;

    const res = await api.post("/api/user/match", {
      app: "__proto__",
      identifier: "polluted",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    // Crucial: Object.prototype must NOT have been polluted as a side effect.
    expect(({} as Record<string, unknown>).polluted).toBe(before);
  });

  it("rejects /api/user/match with constructor as app key", async () => {
    const { token } = await t.registerAndLogin("matchctor", "charmander");
    const api = t.authed(token);
    const res = await api.post("/api/user/match", {
      app: "constructor",
      identifier: "x",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("rejects /api/user/match with unknown app", async () => {
    const { token } = await t.registerAndLogin("matchunknown", "charmander");
    const api = t.authed(token);
    const res = await api.post("/api/user/match", {
      app: "definitely-not-a-real-app",
      identifier: "x",
    });
    expect(res.status).toBe(400);
  });

  it("rejects shop buy with __proto__ as item key", async () => {
    const { token } = await t.registerAndLogin("shopproto", "charmander");
    const api = t.authed(token);
    const before = ({} as Record<string, unknown>).polluted;

    const res = await api.post("/api/shop/buy", {
      item: "__proto__",
      quantity: 1,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // No prototype pollution from a tainted shop key.
    expect(({} as Record<string, unknown>).polluted).toBe(before);
  });

  // ──────────────── Path traversal in login id ────────────────

  it("rejects login with path traversal in id (returns 401)", async () => {
    const res = await t.request.post("/api/auth/login").send({
      id: "../config",
      password: "x",
    });
    // userPath rejects the id → getUser returns null → login returns 401.
    expect(res.status).toBe(401);
  });

  it("rejects login with backslash in id", async () => {
    const res = await t.request.post("/api/auth/login").send({
      id: "..\\users\\someone",
      password: "x",
    });
    expect(res.status).toBe(401);
  });

  it("rejects login with null byte in id", async () => {
    const res = await t.request.post("/api/auth/login").send({
      id: "alice\u0000",
      password: "x",
    });
    expect(res.status).toBe(401);
  });

  // ──────────────── Socket.IO honors tokenInvalidatedAt ────────────────

  it("Socket.IO rejects a token issued before logout-all cutoff", async () => {
    const { issueToken } = await import("../../src/auth/auth.js");
    const { getUser, saveUser } = await import("../../src/storage/user-store.js");

    const { token: oldToken, userId } = await t.registerAndLogin("sockinvalid", "charmander");
    void oldToken;

    // Stamp a tokenInvalidatedAt 10 seconds in the future so the
    // freshly-minted oldToken's iat falls strictly before it.
    const user = await getUser(userId);
    if (!user) throw new Error("seed user missing");
    user.tokenInvalidatedAt = new Date(Date.now() + 10_000).toISOString();
    await saveUser(user);

    // Re-issue a token with explicit iat predating the cutoff.
    const staleIat = Math.floor(Date.now() / 1000) - 10;
    const staleToken = issueToken(userId, staleIat);

    // Boot a Socket.IO server using the same approach as pvp-socket-e2e.
    const { createServer } = await import("node:http");
    const { Server: SocketServer } = await import("socket.io");
    const { io: ioClient } = await import("socket.io-client");
    const { setupPvpSocket } = await import("../../src/pvp/pvp-socket.js");

    const httpServer = createServer();
    const ioServer = new SocketServer(httpServer, { cors: { origin: "*" } });
    setupPvpSocket(ioServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
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
            reject(new Error("should not authenticate with invalidated token"));
          });
        });
        socket.emit("pvp:auth", { token: staleToken });
        const msg = await errored;
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(0);
      } finally {
        socket.disconnect();
      }
    } finally {
      ioServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }, 15000);

  // ──────────────── logout-all returns successor token immediately ────────────────

  it("logout-all returns a usable token without 1+ second mutex hold", async () => {
    const { token } = await t.registerAndLogin("logoutallfast", "charmander");
    const api = t.authed(token);

    const start = Date.now();
    const res = await api.post("/api/auth/logout-all");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    const body = res.body as { token: string };
    expect(typeof body.token).toBe("string");

    // Old contract waited ~1100ms wall-clock inside the lock. The new
    // contract issues the successor token via explicit iat without
    // any sleep, so this should complete in well under a second.
    expect(elapsed).toBeLessThan(900);

    // The new token must immediately authorize a request.
    const reauthed = t.authed(body.token);
    const profile = await reauthed.get("/api/user/profile");
    expect(profile.status).toBe(200);
  });

  // ──────────────── SSRF protection ────────────────

  it("rejects integration creation with localhost URL (SSRF guard)", async () => {
    const { token } = await t.registerAndLogin("ssrfuser", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/integrations", {
      provider: "git",
      label: "evil",
      config: { repoUrl: "http://localhost:8080/internal", authMode: "public" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects integration creation with 127.0.0.1 URL", async () => {
    const { token } = await t.registerAndLogin("ssrfloop", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/integrations", {
      provider: "git",
      label: "evil",
      config: { repoUrl: "http://127.0.0.1/internal", authMode: "public" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects integration creation with 169.254.169.254 (cloud metadata)", async () => {
    const { token } = await t.registerAndLogin("ssrfmeta", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/integrations", {
      provider: "jira",
      label: "evil",
      config: {
        baseUrl: "http://169.254.169.254/latest/meta-data/",
        email: "x@example.com",
        apiToken: "x",
      },
    });
    expect(res.status).toBe(400);
  });

  it("rejects integration creation with private 192.168.x.x range", async () => {
    const { token } = await t.registerAndLogin("ssrfpriv", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/integrations", {
      provider: "git",
      label: "evil",
      config: { repoUrl: "http://192.168.1.1/repo", authMode: "public" },
    });
    expect(res.status).toBe(400);
  });
});
