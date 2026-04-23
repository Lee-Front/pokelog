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
});
