import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "../api/test-helpers.js";

describe("QA: API Contract", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  // ========================================================
  // D1 - GET /api/game/status returns all 8 documented fields
  // ========================================================
  describe("D1: GET /api/game/status response shape", () => {
    it("returns all 8 documented fields", async () => {
      const { token } = await t.registerAndLogin("statusUser", "charmander");
      const api = t.authed(token);

      const res = await api.get("/api/game/status");
      expect(res.status).toBe(200);

      const expectedFields = [
        "nickname",
        "points",
        "totalExp",
        "combo",
        "pendingEventCount",
        "pendingEvolutionCount",
        "todayLog",
        "region",
      ];

      for (const field of expectedFields) {
        expect(
          res.body,
          `response should contain field '${field}'`,
        ).toHaveProperty(field);
      }

      // Verify types of each field
      expect(typeof res.body.nickname).toBe("string");
      expect(typeof res.body.points).toBe("number");
      expect(typeof res.body.totalExp).toBe("number");
      expect(typeof res.body.combo).toBe("object");
      expect(res.body.combo).toHaveProperty("count");
      expect(res.body.combo).toHaveProperty("lastCommitAt");
      expect(typeof res.body.pendingEventCount).toBe("number");
      expect(typeof res.body.pendingEvolutionCount).toBe("number");
      expect(Array.isArray(res.body.todayLog)).toBe(true);
      expect(typeof res.body.region).toBe("string");
    });
  });

  // ========================================================
  // D2 - GET /api/game/pokemon/:uid returns pokemon with evolutionPreview
  // ========================================================
  describe("D2: GET /api/game/pokemon/:uid response shape", () => {
    it("returns pokemon with full structure and evolutionPreview array", async () => {
      const { token } = await t.registerAndLogin("pokemonUser", "bulbasaur");
      const api = t.authed(token);

      // Get party to find the starter's uid
      const partyRes = await api.get("/api/game/party");
      expect(partyRes.status).toBe(200);
      expect(partyRes.body.party.length).toBeGreaterThan(0);
      const uid = partyRes.body.party[0].uid;

      // Fetch pokemon detail
      const res = await api.get(`/api/game/pokemon/${uid}`);
      expect(res.status).toBe(200);

      // Check top-level shape
      expect(res.body).toHaveProperty("pokemon");
      expect(res.body).toHaveProperty("evolutionPreview");
      expect(Array.isArray(res.body.evolutionPreview)).toBe(true);

      // Check pokemon has key OwnedPokemon fields
      const pokemon = res.body.pokemon;
      const ownedPokemonFields = [
        "uid",
        "species",
        "nickname",
        "level",
        "exp",
        "hp",
        "maxHp",
        "stats",
        "moves",
        "caughtAt",
      ];

      for (const field of ownedPokemonFields) {
        expect(pokemon, `pokemon should have field '${field}'`).toHaveProperty(field);
      }

      // Verify species is correct
      expect(pokemon.species).toBe("bulbasaur");

      // Verify stats sub-structure
      expect(pokemon.stats).toHaveProperty("attack");
      expect(pokemon.stats).toHaveProperty("defense");
      expect(pokemon.stats).toHaveProperty("speed");
      expect(pokemon.stats).toHaveProperty("spAttack");
      expect(pokemon.stats).toHaveProperty("spDefense");

      // Verify moves is an array of move objects
      expect(Array.isArray(pokemon.moves)).toBe(true);
      if (pokemon.moves.length > 0) {
        expect(pokemon.moves[0]).toHaveProperty("id");
        expect(pokemon.moves[0]).toHaveProperty("pp");
        expect(pokemon.moves[0]).toHaveProperty("maxPp");
      }

      // evolutionPreview entries should have targetSpecies and targetName when present
      for (const preview of res.body.evolutionPreview) {
        expect(preview).toHaveProperty("targetSpecies");
        expect(preview).toHaveProperty("targetName");
      }
    });
  });

  // ========================================================
  // D5 - Error response consistency
  // ========================================================
  describe("D5: error response consistency", () => {
    it("GET /api/game/pokemon/nonexistent returns 404 with { error }", async () => {
      const { token } = await t.registerAndLogin("errorUser", "squirtle");
      const api = t.authed(token);

      const res = await api.get("/api/game/pokemon/nonexistent");
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
    });

    it("GET /api/game/status without auth returns 401", async () => {
      const res = await t.request.get("/api/game/status");
      expect(res.status).toBe(401);
    });
  });

  // ========================================================
  // B3 - POST /api/auth/register creates user with ALL UserData fields
  // ========================================================
  describe("B3: register creates user with all UserData fields", () => {
    it("party pokemon has all OwnedPokemon fields after registration", async () => {
      const { token } = await t.registerAndLogin("fullUser", "charmander");
      const api = t.authed(token);

      // Fetch party to inspect the starter pokemon
      const partyRes = await api.get("/api/game/party");
      expect(partyRes.status).toBe(200);
      expect(partyRes.body.party).toHaveLength(1);

      const pokemon = partyRes.body.party[0];

      // All OwnedPokemon fields from shared/types.ts
      const requiredFields = [
        "uid",
        "species",
        "nickname",
        "level",
        "exp",
        "hp",
        "maxHp",
        "stats",
        "moves",
        "caughtAt",
      ];

      for (const field of requiredFields) {
        expect(pokemon, `pokemon should have required field '${field}'`).toHaveProperty(field);
      }

      // Fields that createPokemon explicitly sets (not optional/undefined)
      const factoryFields = [
        "variantId",
        "gender",
        "friendship",
        "heldItem",
        "abilityId",
        "moveUsageCounts",
        "damageTakenTotal",
        "tradeLocked",
        "nature",
        "isShiny",
      ];

      for (const field of factoryFields) {
        expect(
          field in pokemon,
          `pokemon should have factory field '${field}'`,
        ).toBe(true);
      }

      // Type checks for key fields
      expect(typeof pokemon.uid).toBe("string");
      expect(pokemon.species).toBe("charmander");
      expect(typeof pokemon.level).toBe("number");
      expect(pokemon.level).toBe(5);
      expect(typeof pokemon.exp).toBe("number");
      expect(typeof pokemon.hp).toBe("number");
      expect(typeof pokemon.maxHp).toBe("number");
      expect(typeof pokemon.stats).toBe("object");
      expect(Array.isArray(pokemon.moves)).toBe(true);
      expect(typeof pokemon.caughtAt).toBe("string");
      expect(typeof pokemon.nature).toBe("string");
      expect(typeof pokemon.isShiny).toBe("boolean");
      expect(typeof pokemon.friendship).toBe("number");
    });
  });
});
