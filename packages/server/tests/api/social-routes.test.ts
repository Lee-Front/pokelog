import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("social routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("GET /ranking returns ranking list", async () => {
    await t.registerAndLogin("rankeduser", "charmander");

    const res = await t.request.get("/api/social/ranking");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.ranking)).toBe(true);
    expect(res.body.ranking.length).toBeGreaterThanOrEqual(1);
    expect(res.body.ranking[0]).toHaveProperty("nickname");
    expect(res.body.ranking[0]).toHaveProperty("totalExp");
  });

  it("GET /ranking supports custom sort field", async () => {
    await t.registerAndLogin("sortuser", "squirtle");

    const res = await t.request.get("/api/social/ranking?by=points");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.ranking)).toBe(true);
  });

  it("GET /profile/:nickname returns user profile", async () => {
    await t.registerAndLogin("pubprofile", "bulbasaur");

    const res = await t.request.get("/api/social/profile/pubprofile");
    expect(res.status).toBe(200);
    expect(res.body.nickname).toBe("pubprofile");
    expect(typeof res.body.totalExp).toBe("number");
    expect(typeof res.body.points).toBe("number");
    expect(typeof res.body.pokedexCount).toBe("number");
    expect(typeof res.body.pokemonCount).toBe("number");
  });

  it("GET /profile/:nickname returns 404 for unknown user", async () => {
    const res = await t.request.get("/api/social/profile/nonexistent");
    expect(res.status).toBe(404);
  });
});
