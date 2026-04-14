import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("user routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("GET /profile returns user profile", async () => {
    const { token } = await t.registerAndLogin("profileuser", "charmander");
    const api = t.authed(token);

    const res = await api.get("/api/user/profile");
    expect(res.status).toBe(200);
    expect(res.body.account.nickname).toBe("profileuser");
    expect(typeof res.body.points).toBe("number");
    expect(Array.isArray(res.body.pokedex)).toBe(true);
  });

  it("GET /search finds users by query", async () => {
    const { token } = await t.registerAndLogin("searchalpha", "charmander");
    await t.registerAndLogin("searchbeta", "squirtle");
    const api = t.authed(token);

    const res = await api.get("/api/user/search?q=search");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    // searchalpha is excluded (own user), searchbeta should appear
    expect(res.body.users.length).toBeGreaterThanOrEqual(1);
  });

  it("PUT /nickname changes nickname", async () => {
    const { token } = await t.registerAndLogin("oldnick", "charmander");
    const api = t.authed(token);

    const put = await api.put("/api/user/nickname", { nickname: "newnick" });
    expect(put.status).toBe(200);
    expect(put.body.nickname).toBe("newnick");

    const profile = await api.get("/api/user/profile");
    expect(profile.body.account.nickname).toBe("newnick");
  });

  it("POST /match creates a git matching", async () => {
    const { token } = await t.registerAndLogin("matchuser", "charmander");
    const api = t.authed(token);

    const res = await api.post("/api/user/match", {
      app: "git",
      identifier: "email@test.com",
    });
    expect(res.status).toBe(200);
    expect(res.body.matchings.git.emails).toContain("email@test.com");
  });

  it("DELETE /match removes a matching", async () => {
    const { token } = await t.registerAndLogin("delmatch", "charmander");
    const api = t.authed(token);

    await api.post("/api/user/match", {
      app: "git",
      identifier: "del@test.com",
    });

    const res = await t.request
      .delete("/api/user/match")
      .set("Authorization", `Bearer ${token}`)
      .send({ app: "git", identifier: "del@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.matchings.git.emails).not.toContain("del@test.com");
  });

  it("GET /integrations returns empty list for new user", async () => {
    const { token } = await t.registerAndLogin("intuser", "charmander");
    const api = t.authed(token);

    const res = await api.get("/api/user/integrations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.integrations)).toBe(true);
    expect(res.body.integrations).toHaveLength(0);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await t.request.get("/api/user/profile");
    expect(res.status).toBe(401);
  });
});
