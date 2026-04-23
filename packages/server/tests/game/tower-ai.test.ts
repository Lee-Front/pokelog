import { describe, it, expect } from "vitest";
import { generateTowerParty, getStageConfig, getGeneralPool } from "../../src/game/tower-ai.js";

describe("tower-ai", () => {
  describe("getStageConfig", () => {
    it("stage 1 uses low level, no items, no legendaries", () => {
      const c = getStageConfig(1);
      expect(c.level).toBe(40);
      expect(c.heldItems).toBe(false);
      expect(c.useLegendary).toBe(false);
      expect(c.competitive).toBe(false);
    });

    it("stage 5 unlocks items", () => {
      const c = getStageConfig(5);
      expect(c.level).toBe(45);
      expect(c.heldItems).toBe(true);
      expect(c.useLegendary).toBe(false);
    });

    it("stage 10 bumps level to 50 and switches to competitive", () => {
      const c = getStageConfig(10);
      expect(c.level).toBe(50);
      expect(c.competitive).toBe(true);
    });

    it("stage 50 allows legendaries", () => {
      const c = getStageConfig(50);
      expect(c.level).toBe(55);
      expect(c.useLegendary).toBe(true);
    });

    it("stage 100 final boss config", () => {
      const c = getStageConfig(100);
      expect(c.level).toBe(60);
      expect(c.useLegendary).toBe(true);
      expect(c.heldItems).toBe(true);
      expect(c.competitive).toBe(true);
    });
  });

  describe("getGeneralPool", () => {
    it("returns a non-empty list of battle-viable species", () => {
      const pool = getGeneralPool();
      expect(pool.length).toBeGreaterThan(100);
      // Spot-check: a pseudo-legendary pokemon (dragonite) should qualify
      expect(pool).toContain("dragonite");
    });

    it("excludes known legendaries and babies", () => {
      const pool = getGeneralPool();
      expect(pool).not.toContain("mewtwo");
      expect(pool).not.toContain("pichu");
      expect(pool).not.toContain("mew");
    });
  });

  describe("generateTowerParty", () => {
    it("returns 3 pokemon at stage 1", () => {
      const party = generateTowerParty(1);
      expect(party).toHaveLength(3);
      for (const p of party) {
        expect(p.level).toBe(40);
        expect(p.heldItem).toBeNull();
      }
    });

    it("applies Species Clause within team", () => {
      for (let i = 0; i < 10; i++) {
        const party = generateTowerParty(15);
        const species = party.map((p) => p.species);
        const unique = new Set(species);
        expect(unique.size).toBe(species.length);
      }
    });

    it("assigns held items at stage 5+", () => {
      const party = generateTowerParty(5);
      expect(party).toHaveLength(3);
      for (const p of party) {
        expect(p.level).toBe(45);
        expect(p.heldItem).toBeTruthy();
      }
    });

    it("scales to level 50 at stage 10-49", () => {
      const party = generateTowerParty(20);
      expect(party).toHaveLength(3);
      for (const p of party) {
        expect(p.level).toBe(50);
      }
    });

    it("stage 50+ may include legendaries", () => {
      const LEGENDARIES = new Set([
        "articuno", "zapdos", "moltres", "mewtwo", "mew",
        "raikou", "entei", "suicune", "lugia", "ho-oh", "celebi",
        "regirock", "regice", "registeel", "latias", "latios", "kyogre",
        "groudon", "rayquaza", "jirachi", "deoxys",
        "uxie", "mesprit", "azelf", "dialga", "palkia", "heatran",
        "regigigas", "giratina", "cresselia", "darkrai", "arceus",
      ]);
      let foundLegendary = false;
      for (let i = 0; i < 30 && !foundLegendary; i++) {
        const party = generateTowerParty(60);
        for (const p of party) {
          if (LEGENDARIES.has(p.species)) {
            foundLegendary = true;
            break;
          }
        }
      }
      expect(foundLegendary).toBe(true);
    });

    it("every pokemon has at least one usable move", () => {
      const party = generateTowerParty(30);
      for (const p of party) {
        expect(p.moves.length).toBeGreaterThan(0);
        expect(p.moves.every((m) => m.pp > 0 && m.maxPp > 0)).toBe(true);
      }
    });

    it("assigns teraType from species primary type", () => {
      const party = generateTowerParty(1);
      for (const p of party) {
        expect(p.teraType).toBeTruthy();
      }
    });
  });
});
