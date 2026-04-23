import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "../api/test-helpers.js";

/**
 * Task 3.1 — End-to-end API flow (register → status → party → judge).
 *
 * Verifies the canonical happy path through the main authenticated
 * endpoints using the in-process app (no child process). This is a
 * regression tripwire: if any of these routes breaks, the flow fails.
 */

describe("API flow (register → status → party → judge)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("registers a fresh user and returns a token", async () => {
    const { token } = await t.registerAndLogin("apiflowuser1", "charmander");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
  });

  it("returns game/status for authenticated user", async () => {
    const { token } = await t.registerAndLogin("apiflowuser2", "squirtle");
    const api = t.authed(token);
    const res = await api.get("/api/game/status");
    expect(res.status).toBe(200);
    expect(res.body.nickname).toBe("apiflowuser2");
    expect(res.body.points).toBe(0);
  });

  it("returns starter party and it has a valid IV block", async () => {
    const { token } = await t.registerAndLogin("apiflowuser3", "bulbasaur");
    const api = t.authed(token);
    const party = await api.get("/api/game/party");
    expect(party.status).toBe(200);
    expect(party.body.party).toHaveLength(1);
    const starter = party.body.party[0];
    expect(starter.species).toBe("bulbasaur");
    // IV system wired — new pokemon should have an ivs object
    expect(starter.ivs).toBeDefined();
    for (const stat of ["hp", "attack", "defense", "spAttack", "spDefense", "speed"]) {
      expect(starter.ivs[stat]).toBeGreaterThanOrEqual(0);
      expect(starter.ivs[stat]).toBeLessThanOrEqual(31);
    }
  });

  it("judges a newly-created pokemon and returns a verdict", async () => {
    const { token } = await t.registerAndLogin("apiflowuser4", "charmander");
    const api = t.authed(token);
    const party = await api.get("/api/game/party");
    const uid = party.body.party[0].uid;
    const judge = await api.get(`/api/user/judge/${uid}`);
    expect(judge.status).toBe(200);
    expect(judge.body.total).toBeGreaterThanOrEqual(0);
    expect(typeof judge.body.verdict).toBe("string");
  });

  it("duplicate registration is rejected with 409", async () => {
    const id = "apiflowdup";
    await t.registerAndLogin(id, "charmander");
    const res = await t.request.post("/api/auth/register").send({
      id,
      password: "testpass123",
      nickname: id,
      starter: "charmander",
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBeDefined();
  });

  it("login with correct credentials returns a token", async () => {
    const id = "apiflowlogin";
    await t.registerAndLogin(id, "charmander");
    const res = await t.request.post("/api/auth/login").send({
      id,
      password: "testpass123",
    });
    expect(res.status).toBe(200);
    expect((res.body as { token: string }).token).toBeDefined();
  });

  it("login with wrong credentials returns 401", async () => {
    const id = "apiflowbadlogin";
    await t.registerAndLogin(id, "charmander");
    const res = await t.request.post("/api/auth/login").send({
      id,
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
  });
});
