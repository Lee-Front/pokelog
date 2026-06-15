import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("admin routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("rejects requests without admin key", async () => {
    const res = await t.request.get("/api/admin/config");
    // No POKELOG_ADMIN_KEY header → middleware returns 503 or 403
    expect([403, 503]).toContain(res.status);
  });

  it("rejects requests with wrong admin key", async () => {
    const res = await t.request
      .get("/api/admin/config")
      .set("x-admin-key", "wrong-key");
    expect(res.status).toBe(403);
  });

  it("GET /config returns server config", async () => {
    const res = await t.admin().get("/api/admin/config");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("meta");
    expect(res.body).toHaveProperty("polling");
    expect(res.body).toHaveProperty("rewards");
  });

  it("POST /repo adds a repository", async () => {
    const res = await t.admin().post("/api/admin/repo", {
      url: "https://github.com/test/repo",
      branches: ["main"],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await t.admin().get("/api/admin/repos");
    expect(list.status).toBe(200);
    expect(list.body.repos.some((r: { url: string }) => r.url === "https://github.com/test/repo")).toBe(true);
  });

  it("DELETE /repo removes a repository", async () => {
    await t.admin().post("/api/admin/repo", {
      url: "https://github.com/test/deleteme",
      branches: ["main"],
    });

    const del = await t.request
      .delete("/api/admin/repo")
      .set("x-admin-key", "test-admin-key")
      .send({ url: "https://github.com/test/deleteme" });
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const list = await t.admin().get("/api/admin/repos");
    expect(list.body.repos.some((r: { url: string }) => r.url === "https://github.com/test/deleteme")).toBe(false);
  });

  it("POST /test/give-points gives points to user", async () => {
    const { token, userId } = await t.registerAndLogin("pointsuser", "charmander");

    const res = await t.admin().post("/api/admin/test/give-points", {
      userId,
      amount: 500,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.points).toBe(500);

    const status = await t.authed(token).get("/api/game/status");
    expect(status.status).toBe(200);
    expect(status.body.points).toBe(500);
  });

  it("POST /test/give-item gives item to user", async () => {
    const { token, userId } = await t.registerAndLogin("itemuser", "charmander");

    const res = await t.admin().post("/api/admin/test/give-item", {
      userId,
      item: "pokeball",
      quantity: 3,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const inv = await t.authed(token).get("/api/game/inventory");
    expect(inv.status).toBe(200);
    // inventory is Record<string, number>, starter gets 5 pokeballs + 3 given = 8
    expect(inv.body.inventory.pokeball).toBe(8);
  });

  it("POST /test/give-pokemon gives pokemon to user", async () => {
    const { token, userId } = await t.registerAndLogin("pokeuser", "charmander");

    const res = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "pikachu",
      level: 10,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.pokemon.species).toBe("pikachu");

    const party = await t.authed(token).get("/api/game/party");
    expect(party.status).toBe(200);
    const pikachu = party.body.party.find((p: { species: string }) => p.species === "pikachu");
    expect(pikachu).toBeDefined();
    expect(pikachu.level).toBe(10);
  });

  it("GET /users returns a balance summary per user", async () => {
    const { userId } = await t.registerAndLogin("summaryuser", "charmander");
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 250 });

    const res = await t.admin().get("/api/admin/users");
    expect(res.status).toBe(200);
    const entry = res.body.find((u: { id: string }) => u.id === userId);
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      id: userId,
      points: 250,
      integrationCount: 0,
    });
    expect(typeof entry.totalExp).toBe("number");
  });

  it("POST /users/:id/recompute returns before/after for a user with no git commits", async () => {
    // A freshly registered user with admin-granted points has no git
    // integrations, so recompute resets the non-commit balance to 0.
    const { userId } = await t.registerAndLogin("recompuser", "charmander");
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 999 });

    const res = await t.admin().post(`/api/admin/users/${userId}/recompute`);
    expect(res.status).toBe(200);
    expect(res.body.before.points).toBe(999);
    expect(res.body.after.points).toBe(0); // no commits to re-credit
    expect(res.body.after.totalExp).toBe(0);
  });

  it("POST /users/:id/recompute returns 404 for an unknown user", async () => {
    const res = await t.admin().post("/api/admin/users/nope-not-real/recompute");
    expect(res.status).toBe(404);
  });

  it("ships conservative reward defaults (DEFAULT_CONFIG)", async () => {
    // Asserted against DEFAULT_CONFIG directly; the test harness writes its own
    // config.json so the live /config merges test overrides on top.
    const { DEFAULT_CONFIG } = await import("../../src/storage/config-store.js");
    expect(DEFAULT_CONFIG.rewards.pointsPerByte).toBe(0.01);
    expect(DEFAULT_CONFIG.rewards.expPerByte).toBe(0.05);
    expect(DEFAULT_CONFIG.rewards.combo.maxMultiplier).toBe(1.5);
    expect(DEFAULT_CONFIG.rewards.combo.multipliers).toEqual([1, 1.2, 1.5]);
  });

  it("allows runtime tuning of the combo multipliers curve", async () => {
    const res = await t.admin().put("/api/admin/config", {
      key: "rewards.combo.multipliers",
      value: [1, 1.3, 1.8, 2.5],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const config = await t.admin().get("/api/admin/config");
    expect(config.body.rewards.combo.multipliers).toEqual([1, 1.3, 1.8, 2.5]);
  });

  it("rejects a malformed combo multipliers value", async () => {
    for (const bad of [[], "nope", [1, -2], [1, "x"], [1, 0]]) {
      const res = await t.admin().put("/api/admin/config", {
        key: "rewards.combo.multipliers",
        value: bad as unknown,
      });
      expect(res.status).toBe(400);
    }
  });

  it("allows runtime tuning of pointsPerByte and maxMultiplier", async () => {
    const a = await t.admin().put("/api/admin/config", { key: "rewards.pointsPerByte", value: 0.02 });
    expect(a.status).toBe(200);
    const b = await t.admin().put("/api/admin/config", { key: "rewards.combo.maxMultiplier", value: 2.0 });
    expect(b.status).toBe(200);

    const config = await t.admin().get("/api/admin/config");
    expect(config.body.rewards.pointsPerByte).toBe(0.02);
    expect(config.body.rewards.combo.maxMultiplier).toBe(2.0);
  });
});
