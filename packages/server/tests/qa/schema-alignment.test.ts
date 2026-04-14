import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches } from "../../src/game/data-loader.js";
import { createPokemon, createWildPokemon } from "../../src/game/pokemon-factory.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

beforeAll(() => clearAllCaches());

describe("QA: Schema Alignment", () => {
  // ========================================================
  // B1 - createPokemon returns all 19 OwnedPokemon fields
  // ========================================================
  describe("B1: createPokemon returns all 19 OwnedPokemon fields", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("createPokemon('bulbasaur', 5) has all 19 fields with correct types", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const pokemon = createPokemon("bulbasaur", 5);

      // uid
      expect(typeof pokemon.uid).toBe("string");
      expect(pokemon.uid.length).toBeGreaterThan(0);

      // species
      expect(pokemon.species).toBe("bulbasaur");

      // variantId
      expect(pokemon).toHaveProperty("variantId");
      expect(pokemon.variantId === null || typeof pokemon.variantId === "string").toBe(true);

      // nickname
      expect(pokemon).toHaveProperty("nickname");
      expect(pokemon.nickname === null || typeof pokemon.nickname === "string").toBe(true);

      // level
      expect(pokemon.level).toBe(5);
      expect(typeof pokemon.level).toBe("number");

      // exp
      expect(pokemon.exp).toBe(0);
      expect(typeof pokemon.exp).toBe("number");

      // hp
      expect(typeof pokemon.hp).toBe("number");
      expect(pokemon.hp).toBeGreaterThan(0);

      // maxHp
      expect(typeof pokemon.maxHp).toBe("number");
      expect(pokemon.maxHp).toBeGreaterThan(0);
      expect(pokemon.hp).toBe(pokemon.maxHp);

      // stats
      expect(typeof pokemon.stats).toBe("object");
      expect(pokemon.stats).not.toBeNull();
      expect(typeof pokemon.stats.attack).toBe("number");
      expect(typeof pokemon.stats.defense).toBe("number");
      expect(typeof pokemon.stats.speed).toBe("number");
      expect(typeof pokemon.stats.spAttack).toBe("number");
      expect(typeof pokemon.stats.spDefense).toBe("number");

      // moves
      expect(Array.isArray(pokemon.moves)).toBe(true);
      for (const move of pokemon.moves) {
        expect(typeof move.id).toBe("string");
        expect(typeof move.pp).toBe("number");
        expect(typeof move.maxPp).toBe("number");
      }

      // caughtAt
      expect(typeof pokemon.caughtAt).toBe("string");
      expect(new Date(pokemon.caughtAt).getTime()).not.toBeNaN();

      // gender
      expect(pokemon).toHaveProperty("gender");
      expect(
        pokemon.gender === null
        || pokemon.gender === "male"
        || pokemon.gender === "female"
        || pokemon.gender === "genderless",
      ).toBe(true);

      // friendship
      expect(pokemon).toHaveProperty("friendship");
      expect(typeof pokemon.friendship).toBe("number");
      expect(pokemon.friendship).toBeGreaterThanOrEqual(0);

      // heldItem
      expect(pokemon).toHaveProperty("heldItem");
      expect(pokemon.heldItem === null || typeof pokemon.heldItem === "string").toBe(true);

      // abilityId
      expect(pokemon).toHaveProperty("abilityId");
      expect(pokemon.abilityId === null || typeof pokemon.abilityId === "string").toBe(true);

      // moveUsageCounts
      expect(pokemon).toHaveProperty("moveUsageCounts");
      expect(typeof pokemon.moveUsageCounts).toBe("object");

      // damageTakenTotal
      expect(pokemon).toHaveProperty("damageTakenTotal");
      expect(typeof pokemon.damageTakenTotal).toBe("number");

      // nature
      expect(pokemon).toHaveProperty("nature");
      expect(typeof pokemon.nature).toBe("string");
      expect(pokemon.nature!.length).toBeGreaterThan(0);

      // isShiny
      expect(pokemon).toHaveProperty("isShiny");
      expect(typeof pokemon.isShiny).toBe("boolean");

      // Verify exactly 19 keys present
      const expectedKeys = [
        "uid", "species", "variantId", "nickname", "level", "exp",
        "hp", "maxHp", "stats", "moves", "caughtAt", "gender",
        "friendship", "heldItem", "abilityId", "moveUsageCounts",
        "damageTakenTotal", "nature", "isShiny",
      ];
      for (const key of expectedKeys) {
        expect(pokemon, `missing key: ${key}`).toHaveProperty(key);
      }
    });
  });

  // ========================================================
  // B2 - createWildPokemon returns all 9 WildPokemon fields
  // ========================================================
  describe("B2: createWildPokemon returns all WildPokemon fields", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("createWildPokemon('pikachu', 10) has all 9 fields present", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);

      const wild = createWildPokemon("pikachu", 10);

      // species
      expect(wild.species).toBe("pikachu");
      expect(typeof wild.species).toBe("string");

      // level
      expect(wild.level).toBe(10);
      expect(typeof wild.level).toBe("number");

      // hp
      expect(typeof wild.hp).toBe("number");
      expect(wild.hp).toBeGreaterThan(0);

      // maxHp
      expect(typeof wild.maxHp).toBe("number");
      expect(wild.hp).toBe(wild.maxHp);

      // stats
      expect(typeof wild.stats).toBe("object");
      expect(wild.stats).not.toBeNull();
      expect(typeof wild.stats.attack).toBe("number");
      expect(typeof wild.stats.defense).toBe("number");
      expect(typeof wild.stats.speed).toBe("number");
      expect(typeof wild.stats.spAttack).toBe("number");
      expect(typeof wild.stats.spDefense).toBe("number");

      // moves
      expect(Array.isArray(wild.moves)).toBe(true);
      for (const move of wild.moves) {
        expect(typeof move.id).toBe("string");
        expect(typeof move.pp).toBe("number");
        expect(typeof move.maxPp).toBe("number");
      }

      // nature
      expect(wild).toHaveProperty("nature");
      expect(typeof wild.nature).toBe("string");

      // gender
      expect(wild).toHaveProperty("gender");
      expect(
        wild.gender === "male"
        || wild.gender === "female"
        || wild.gender === "genderless",
      ).toBe(true);

      // ability
      expect(wild).toHaveProperty("ability");
      expect(wild.ability === undefined || typeof wild.ability === "string").toBe(true);

      // Verify all 9 keys
      const expectedKeys = [
        "species", "level", "hp", "maxHp", "stats", "moves",
        "nature", "gender", "ability",
      ];
      for (const key of expectedKeys) {
        expect(wild, `missing key: ${key}`).toHaveProperty(key);
      }
    });
  });

  // ========================================================
  // B4 - normalizeOwnedPokemon fills optional fields
  //      (tested indirectly via saveUser/getUser round-trip)
  // ========================================================
  describe("B4: normalizeOwnedPokemon fills optional fields for legacy data", () => {
    type UserStoreModule = typeof import("../../src/storage/user-store.js");

    let tmpDir: string;
    let userStoreModule: UserStoreModule;

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-schema-b4-"));
      fs.mkdirSync(path.join(tmpDir, "users"), { recursive: true });
      process.env.POKELOG_DATA_DIR = tmpDir;
      vi.resetModules();
      clearAllCaches();
      userStoreModule = await import("../../src/storage/user-store.js");
    });

    afterEach(() => {
      delete process.env.POKELOG_DATA_DIR;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("fills all optional OwnedPokemon fields when given minimal legacy data", async () => {
      const minimalPokemon: OwnedPokemon = {
        uid: "legacy-uid-001",
        species: "bulbasaur",
        nickname: null,
        level: 5,
        exp: 0,
        hp: 25,
        maxHp: 25,
        stats: { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 },
        moves: [],
        caughtAt: "2023-01-01T00:00:00Z",
        // Intentionally omit all optional fields:
        // variantId, gender, friendship, heldItem, abilityId,
        // moveUsageCounts, damageTakenTotal, nature, isShiny
      };

      const userData: UserData = {
        account: {
          id: "test-user-b4",
          password: "pw",
          nickname: "tester",
          createdAt: "2023-01-01T00:00:00Z",
          matchings: {},
        },
        currentRegion: "default",
        points: 0,
        totalExp: 0,
        combo: { count: 0, lastCommitAt: null },
        encounterCeiling: { accumulatedBytes: 0 },
        party: [],
        pokemon: [minimalPokemon],
        eggs: [],
        pokedex: [],
        inventory: {},
        pendingEvents: [],
        pendingEvolutions: [],
        battleState: null,
        storage: [],
        log: [],
        integrations: [],
      };

      await userStoreModule.saveUser(userData);
      const loaded = await userStoreModule.getUser("test-user-b4");
      expect(loaded).not.toBeNull();

      const normalized = loaded!.pokemon[0];

      // nature defaults to "hardy"
      expect(normalized.nature).toBe("hardy");

      // isShiny defaults to false
      expect(normalized.isShiny).toBe(false);

      // gender is determined (not undefined)
      expect(normalized.gender).toBeDefined();
      expect(
        normalized.gender === "male"
        || normalized.gender === "female"
        || normalized.gender === "genderless",
      ).toBe(true);

      // friendship defaults to 70
      expect(normalized.friendship).toBe(70);

      // heldItem defaults to null
      expect(normalized.heldItem).toBeNull();

      // abilityId defaults to null
      expect(normalized.abilityId).toBeNull();

      // variantId defaults to null
      expect(normalized.variantId).toBeNull();

      // moveUsageCounts defaults to object
      expect(typeof normalized.moveUsageCounts).toBe("object");

      // damageTakenTotal defaults to number
      expect(typeof normalized.damageTakenTotal).toBe("number");
      expect(normalized.damageTakenTotal).toBe(0);

    });
  });

  // ========================================================
  // B5 - normalizeUserData fills optional UserData fields
  // ========================================================
  describe("B5: normalizeUserData fills optional UserData fields", () => {
    type UserStoreModule = typeof import("../../src/storage/user-store.js");

    let tmpDir: string;
    let userStoreModule: UserStoreModule;

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-schema-b5-"));
      fs.mkdirSync(path.join(tmpDir, "users"), { recursive: true });
      process.env.POKELOG_DATA_DIR = tmpDir;
      vi.resetModules();
      clearAllCaches();
      userStoreModule = await import("../../src/storage/user-store.js");
    });

    afterEach(() => {
      delete process.env.POKELOG_DATA_DIR;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    });

    it("fills currentRegion, pendingEvolutions, eggs when missing", async () => {
      // Write a minimal user JSON that is missing optional fields.
      // We write the file directly to bypass saveUser's normalization on save,
      // so getUser's normalization is what we test.
      const minimalUserJson = {
        account: {
          id: "test-user-b5",
          password: "pw",
          nickname: "tester",
          createdAt: "2023-01-01T00:00:00Z",
          matchings: {},
        },
        // currentRegion intentionally missing
        points: 100,
        totalExp: 50,
        combo: { count: 0, lastCommitAt: null },
        encounterCeiling: { accumulatedBytes: 0 },
        party: [],
        pokemon: [],
        // eggs intentionally missing
        pokedex: [],
        inventory: {},
        pendingEvents: [],
        // pendingEvolutions intentionally missing
        battleState: null,
        storage: [],
        log: [],
        integrations: [],
      };

      const userFilePath = path.join(tmpDir, "users", "test-user-b5.json");
      fs.writeFileSync(userFilePath, JSON.stringify(minimalUserJson));

      const loaded = await userStoreModule.getUser("test-user-b5");
      expect(loaded).not.toBeNull();

      // currentRegion defaults to "default"
      expect(loaded!.currentRegion).toBe("default");

      // pendingEvolutions defaults to []
      expect(Array.isArray(loaded!.pendingEvolutions)).toBe(true);
      expect(loaded!.pendingEvolutions).toHaveLength(0);

      // eggs defaults to []
      expect(Array.isArray(loaded!.eggs)).toBe(true);
      expect(loaded!.eggs).toHaveLength(0);
    });
  });
});
