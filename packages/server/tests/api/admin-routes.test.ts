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
    expect(res.body.repos.some((r: { url: string }) => r.url === "https://github.com/test/repo")).toBe(true);

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
    expect(del.body.repos.some((r: { url: string }) => r.url === "https://github.com/test/deleteme")).toBe(false);

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
    expect(res.body.pokemon.species).toBe("pikachu");

    const party = await t.authed(token).get("/api/game/party");
    expect(party.status).toBe(200);
    const pikachu = party.body.party.find((p: { species: string }) => p.species === "pikachu");
    expect(pikachu).toBeDefined();
    expect(pikachu.level).toBe(10);
  });
});
