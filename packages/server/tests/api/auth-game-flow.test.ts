import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("auth + game flow", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t.cleanup();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await t.request.get("/api/game/status");
    expect(res.status).toBe(401);
  });

  it("registers a new user with starter pokemon", async () => {
    const { token, userId } = await t.registerAndLogin("player1", "charmander");
    expect(token).toBeTruthy();

    const api = t.authed(token);
    const status = await api.get("/api/game/status");
    expect(status.status).toBe(200);
    expect(status.body.nickname).toBe("player1");
    expect(status.body.points).toBe(0);
  });

  it("returns party with starter pokemon", async () => {
    const { token } = await t.registerAndLogin("player2", "squirtle");
    const api = t.authed(token);

    const party = await api.get("/api/game/party");
    expect(party.status).toBe(200);
    expect(party.body.party).toHaveLength(1);
    expect(party.body.party[0].species).toBe("squirtle");
    expect(party.body.party[0].level).toBe(5);
    // nature 배정 확인
    expect(party.body.party[0].nature).toBeDefined();
    expect(typeof party.body.party[0].nature).toBe("string");
    // isShiny 배정 확인
    expect(typeof party.body.party[0].isShiny).toBe("boolean");
    // gender 배정 확인
    expect(party.body.party[0].gender).toBeDefined();
  });

  it("shows pokedex with starter species", async () => {
    const { token } = await t.registerAndLogin("player3", "bulbasaur");
    const api = t.authed(token);

    const pokedex = await api.get("/api/game/pokedex");
    expect(pokedex.status).toBe(200);
    expect(pokedex.body.seen).toContain("bulbasaur");
  });

  it("heals party to full HP", async () => {
    const { token } = await t.registerAndLogin("player4", "charmander");
    const api = t.authed(token);

    const heal = await api.post("/api/game/heal");
    expect(heal.status).toBe(200);
    expect(heal.body.healed).toBeDefined();
  });

  it("returns region info", async () => {
    const { token } = await t.registerAndLogin("player5", "charmander");
    const api = t.authed(token);

    const status = await api.get("/api/game/status");
    expect(status.status).toBe(200);
    expect(status.body.region).toBeDefined();
  });

  it("prevents duplicate registration", async () => {
    const id = "dupuser";
    await t.registerAndLogin(id);

    const res = await t.request.post("/api/auth/register").send({
      id,
      password: "pass",
      nickname: "dup",
      starter: "charmander",
    });
    expect(res.status).toBe(409);
  });
});
