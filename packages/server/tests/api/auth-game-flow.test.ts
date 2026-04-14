import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("auth + game flow", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await t.request.get("/api/game/status");
    expect(res.status).toBe(401);
  });

  it("registers a new user with starter pokemon", async () => {
    const { token, userId } = await t.registerAndLogin("player1", "charmander");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

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
    expect(typeof party.body.party[0].nature).toBe("string");
    expect(party.body.party[0].nature.length).toBeGreaterThan(0);
    // isShiny 배정 확인
    expect(typeof party.body.party[0].isShiny).toBe("boolean");
    // gender 배정 확인
    expect(["male", "female", "genderless"]).toContain(party.body.party[0].gender);
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
    expect(typeof heal.body.healed).toBe("number");
    expect(heal.body.healed).toBeGreaterThanOrEqual(0);
  });

  it("heal restores damaged pokemon HP to maxHp", async () => {
    const { token, userId } = await t.registerAndLogin("healcheck", "charmander");
    const api = t.authed(token);

    // Get party to find the pokemon uid and maxHp
    const partyBefore = await api.get("/api/game/party");
    expect(partyBefore.status).toBe(200);
    const pokemon = partyBefore.body.party[0];

    // Damage the pokemon by setting HP to 1 via file manipulation
    const userFile = path.join(t.dataDir, "users", `${userId}.json`);
    const userData = JSON.parse(fs.readFileSync(userFile, "utf-8"));
    const pokemonInFile = userData.pokemon.find((p: { uid: string }) => p.uid === pokemon.uid);
    pokemonInFile.hp = 1;
    fs.writeFileSync(userFile, JSON.stringify(userData));

    // Heal the party
    const heal = await api.post("/api/game/heal");
    expect(heal.status).toBe(200);

    // Verify HP is restored to maxHp
    const partyAfter = await api.get("/api/game/party");
    expect(partyAfter.status).toBe(200);
    const healed = partyAfter.body.party[0];
    expect(healed.hp).toBe(healed.maxHp);
  });

  it("returns region info", async () => {
    const { token } = await t.registerAndLogin("player5", "charmander");
    const api = t.authed(token);

    const status = await api.get("/api/game/status");
    expect(status.status).toBe(200);
    expect(typeof status.body.region).toBe("string");
    expect(status.body.region.length).toBeGreaterThan(0);
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

  it("rejects login with wrong password", async () => {
    await t.registerAndLogin("wrongpw");
    const res = await t.request.post("/api/auth/login").send({
      id: "wrongpw",
      password: "incorrect",
    });
    expect(res.status).toBe(401);
  });

  it("rejects login with nonexistent user", async () => {
    const res = await t.request.post("/api/auth/login").send({
      id: "nosuchuser",
      password: "whatever",
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid starter pokemon", async () => {
    const res = await t.request.post("/api/auth/register").send({
      id: "badstarter",
      password: "pass",
      nickname: "badstarter",
      starter: "pikachu",
    });
    expect(res.status).toBe(400);
  });

  it("party pokemon has moves array with at least 1 move", async () => {
    const { token } = await t.registerAndLogin("movescheck", "charmander");
    const api = t.authed(token);

    const party = await api.get("/api/game/party");
    expect(party.status).toBe(200);
    const pokemon = party.body.party[0];
    expect(Array.isArray(pokemon.moves)).toBe(true);
    expect(pokemon.moves.length).toBeGreaterThanOrEqual(1);
  });

  it("party pokemon has stats with attack, defense, speed, spAttack, spDefense", async () => {
    const { token } = await t.registerAndLogin("statscheck", "squirtle");
    const api = t.authed(token);

    const party = await api.get("/api/game/party");
    expect(party.status).toBe(200);
    const stats = party.body.party[0].stats;
    expect(typeof stats).toBe("object");
    expect(typeof stats.attack).toBe("number");
    expect(typeof stats.defense).toBe("number");
    expect(typeof stats.speed).toBe("number");
    expect(typeof stats.spAttack).toBe("number");
    expect(typeof stats.spDefense).toBe("number");
  });
});
