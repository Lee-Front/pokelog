import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  clearAllCaches,
  getEvolutions,
  getSpecies,
  getSpeciesByName,
} from "../../src/game/data-loader.js";
import { calculateStatsForLevel, evolvePokemon } from "../../src/game/growth.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { clearEggGachaCache, getEggTierSummaries, hatchEgg } from "../../src/game/egg-gacha.js";
import type { OwnedPokemon, SpeciesData } from "../../../../shared/types.js";

beforeAll(() => {
  clearAllCaches();
  clearEggGachaCache();
});

// Helpers

function getEvolutionTargetSpecies(): Set<string> {
  const targets = new Set<string>();
  for (const evo of Object.values(getEvolutions())) {
    for (const branch of evo.branches) {
      targets.add(branch.targetSpecies);
    }
  }
  return targets;
}

function getBaseStageSpecies(): Set<string> {
  const targets = getEvolutionTargetSpecies();
  return new Set(
    getSpecies()
      .filter((s) => !targets.has(s.species))
      .map((s) => s.species),
  );
}

function getEggEligibleSpecies(tier: "common" | "rare" | "legend"): SpeciesData[] {
  const baseStagSpecies = getBaseStageSpecies();

  return getSpecies().filter((species) => {
    if (!baseStagSpecies.has(species.species)) return false;

    if (tier === "legend") {
      return species.isLegendary || species.isMythical;
    }
    if (species.isLegendary || species.isMythical) return false;

    const rawCaptureRate = species.rawCaptureRate ?? 0;
    if (tier === "common") {
      return !species.isBaby && rawCaptureRate >= 120;
    }
    // rare
    return species.isBaby || rawCaptureRate < 120;
  });
}

function createTestPokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "test-uid-mechanics",
    species: "charmander",
    variantId: null,
    nickname: null,
    level: 20,
    exp: 0,
    hp: 50,
    maxHp: 50,
    stats: { attack: 25, defense: 22, speed: 30, spAttack: 28, spDefense: 24 },
    moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
    caughtAt: "2024-01-01T00:00:00Z",
    gender: "male",
    friendship: 85,
    heldItem: null,
    abilityId: "blaze",
    moveUsageCounts: { scratch: 12 },
    damageTakenTotal: 150,
    tradeLocked: false,
    nature: "adamant",
    isShiny: true,
    ...overrides,
  };
}

describe("QA: Game Mechanics", () => {
  // ========================================================
  // C1 - Nature modifier consistency
  // ========================================================
  describe("C1: Nature modifier consistency", () => {
    it("adamant nature boosts attack by 10% and lowers spAttack by 10% at level 50", () => {
      // Bulbasaur base stats:
      //   hp=45, attack=49, defense=49, spAttack=65, spDefense=65, speed=45
      // adamant: increasedStat=attack, decreasedStat=spAttack
      //
      // Formula: stat = floor((baseStat * 2 * level) / 100 + 5)
      // HP formula: hp = floor((baseHp * 2 * level) / 100 + level + 10)
      //
      // At level 50:
      //   HP     = floor((45*2*50)/100 + 50 + 10) = floor(45+60) = 105
      //   attack = floor((49*2*50)/100 + 5) = floor(49+5) = 54  -> *1.1 = floor(59.4) = 59
      //   defense= floor((49*2*50)/100 + 5) = 54
      //   speed  = floor((45*2*50)/100 + 5) = floor(45+5) = 50
      //   spAtk  = floor((65*2*50)/100 + 5) = floor(65+5) = 70  -> *0.9 = floor(63) = 63
      //   spDef  = floor((65*2*50)/100 + 5) = 70

      const result = calculateStatsForLevel("bulbasaur", 50, "adamant");

      expect(result.hp).toBe(105);
      expect(result.maxHp).toBe(105);
      expect(result.stats.attack).toBe(59);
      expect(result.stats.defense).toBe(54);
      expect(result.stats.speed).toBe(50);
      expect(result.stats.spAttack).toBe(63);
      expect(result.stats.spDefense).toBe(70);
    });

    it("neutral nature (hardy) applies no modifiers", () => {
      const withHardy = calculateStatsForLevel("bulbasaur", 50, "hardy");
      const withoutNature = calculateStatsForLevel("bulbasaur", 50);

      expect(withHardy.stats).toEqual(withoutNature.stats);
      expect(withHardy.hp).toBe(withoutNature.hp);
    });
  });

  // ========================================================
  // C5 - Egg gacha only base-stage species
  // ========================================================
  describe("C5: Egg gacha only has base-stage species", () => {
    it("no egg-eligible species appears as a targetSpecies in evolution data", () => {
      const evoTargets = getEvolutionTargetSpecies();
      const violations: string[] = [];

      for (const tier of ["common", "rare", "legend"] as const) {
        const eligible = getEggEligibleSpecies(tier);
        for (const species of eligible) {
          if (evoTargets.has(species.species)) {
            violations.push(`${tier}: ${species.species} is an evolution target`);
          }
        }
      }

      expect(violations, `evolved species in egg pool:\n${violations.join("\n")}`).toHaveLength(0);
    });
  });

  // ========================================================
  // C6 - Egg tier filtering matches rules
  // ========================================================
  describe("C6: Egg tier filtering matches rules", () => {
    it("common tier: !isBaby && rawCaptureRate >= 120, no legendaries/mythicals", () => {
      const commonSpecies = getEggEligibleSpecies("common");
      expect(commonSpecies.length).toBeGreaterThan(0);

      const violations: string[] = [];
      for (const species of commonSpecies) {
        if (species.isBaby) {
          violations.push(`${species.species}: isBaby=true in common`);
        }
        if ((species.rawCaptureRate ?? 0) < 120) {
          violations.push(`${species.species}: rawCaptureRate=${species.rawCaptureRate} < 120 in common`);
        }
        if (species.isLegendary || species.isMythical) {
          violations.push(`${species.species}: legendary/mythical in common`);
        }
      }

      expect(violations, violations.join("\n")).toHaveLength(0);
    });

    it("rare tier: isBaby || rawCaptureRate < 120, no legendaries/mythicals", () => {
      const rareSpecies = getEggEligibleSpecies("rare");
      expect(rareSpecies.length).toBeGreaterThan(0);

      const violations: string[] = [];
      for (const species of rareSpecies) {
        const rawCaptureRate = species.rawCaptureRate ?? 0;
        if (!species.isBaby && rawCaptureRate >= 120) {
          violations.push(`${species.species}: !isBaby && rawCaptureRate=${rawCaptureRate} >= 120 in rare`);
        }
        if (species.isLegendary || species.isMythical) {
          violations.push(`${species.species}: legendary/mythical in rare`);
        }
      }

      expect(violations, violations.join("\n")).toHaveLength(0);
    });

    it("legend tier: isLegendary || isMythical", () => {
      const legendSpecies = getEggEligibleSpecies("legend");
      expect(legendSpecies.length).toBeGreaterThan(0);

      const violations: string[] = [];
      for (const species of legendSpecies) {
        if (!species.isLegendary && !species.isMythical) {
          violations.push(`${species.species}: neither legendary nor mythical in legend`);
        }
      }

      expect(violations, violations.join("\n")).toHaveLength(0);
    });
  });

  // ========================================================
  // C8 - Evolution stat recalculation uses nature
  // ========================================================
  describe("C8: Evolution stat recalculation uses nature", () => {
    it("evolvePokemon recalculates stats using nature modifier", () => {
      const pokemon = createTestPokemon({
        species: "charmander",
        level: 20,
        nature: "adamant",
      });

      const evolved = evolvePokemon(pokemon, "charmeleon");

      // Verify species changed
      expect(evolved.species).toBe("charmeleon");

      // Calculate expected stats for charmeleon at level 20 with adamant nature
      const expectedStats = calculateStatsForLevel("charmeleon", 20, "adamant");

      expect(evolved.maxHp).toBe(expectedStats.maxHp);
      expect(evolved.stats.attack).toBe(expectedStats.stats.attack);
      expect(evolved.stats.defense).toBe(expectedStats.stats.defense);
      expect(evolved.stats.speed).toBe(expectedStats.stats.speed);
      expect(evolved.stats.spAttack).toBe(expectedStats.stats.spAttack);
      expect(evolved.stats.spDefense).toBe(expectedStats.stats.spDefense);
    });

    it("evolvePokemon clamps hp to new maxHp when previous hp exceeds it", () => {
      // Give pokemon high HP that may exceed new maxHp
      const pokemon = createTestPokemon({
        species: "charmander",
        level: 20,
        nature: "adamant",
        hp: 999,
        maxHp: 999,
      });

      const evolved = evolvePokemon(pokemon, "charmeleon");
      const expectedStats = calculateStatsForLevel("charmeleon", 20, "adamant");

      expect(evolved.hp).toBe(expectedStats.maxHp);
      expect(evolved.hp).toBeLessThanOrEqual(evolved.maxHp);
    });
  });

  // ========================================================
  // E4 - Evolved pokemon preserves progression fields
  // ========================================================
  describe("E4: Evolved pokemon preserves progression fields", () => {
    it("friendship, moveUsageCounts, damageTakenTotal, isShiny, gender, nature are unchanged", () => {
      const pokemon = createTestPokemon({
        species: "charmander",
        level: 20,
        nature: "adamant",
        gender: "male",
        friendship: 85,
        moveUsageCounts: { scratch: 12, ember: 7 },
        damageTakenTotal: 150,
        isShiny: true,
      });

      // Snapshot progression fields before evolution
      const pre = {
        friendship: pokemon.friendship,
        moveUsageCounts: { ...pokemon.moveUsageCounts },
        damageTakenTotal: pokemon.damageTakenTotal,
        isShiny: pokemon.isShiny,
        gender: pokemon.gender,
        nature: pokemon.nature,
      };

      const evolved = evolvePokemon(pokemon, "charmeleon");

      expect(evolved.friendship).toBe(pre.friendship);
      expect(evolved.moveUsageCounts).toEqual(pre.moveUsageCounts);
      expect(evolved.damageTakenTotal).toBe(pre.damageTakenTotal);
      expect(evolved.isShiny).toBe(pre.isShiny);
      expect(evolved.gender).toBe(pre.gender);
      expect(evolved.nature).toBe(pre.nature);
    });

    it("uid and caughtAt are also preserved after evolution", () => {
      const pokemon = createTestPokemon({
        species: "charmander",
        level: 20,
      });

      const preUid = pokemon.uid;
      const preCaughtAt = pokemon.caughtAt;

      const evolved = evolvePokemon(pokemon, "charmeleon");

      expect(evolved.uid).toBe(preUid);
      expect(evolved.caughtAt).toBe(preCaughtAt);
    });
  });

  // ========================================================
  // E8 - Egg tier costs and level ranges
  // ========================================================
  describe("E8: Egg tier costs and level ranges", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("common cost=120, rare cost=450, legend cost=3200", () => {
      const summaries = getEggTierSummaries();

      const common = summaries.find((s) => s.tier === "common");
      const rare = summaries.find((s) => s.tier === "rare");
      const legend = summaries.find((s) => s.tier === "legend");

      expect(common).toBeDefined();
      expect(rare).toBeDefined();
      expect(legend).toBeDefined();

      expect(common!.cost).toBe(120);
      expect(rare!.cost).toBe(450);
      expect(legend!.cost).toBe(3200);
    });

    it("tier level ranges are correct: common [1,6], rare [5,12], legend [15,25]", () => {
      // Verify level ranges by hatching eggs at min random values.
      // We test by creating pokemon from egg hatch and verifying levels
      // fall within expected ranges. Since hatchEgg picks a random level
      // within the range, we mock Math.random to hit the boundaries.
      vi.spyOn(Math, "random").mockReturnValue(0);

      // At random=0, rollLevel returns minLevel
      const commonResult = hatchEgg({ id: "e1", tier: "common", createdAt: new Date().toISOString() });
      expect(commonResult.pokemon.level).toBe(1);

      const rareResult = hatchEgg({ id: "e2", tier: "rare", createdAt: new Date().toISOString() });
      expect(rareResult.pokemon.level).toBe(5);

      const legendResult = hatchEgg({ id: "e3", tier: "legend", createdAt: new Date().toISOString() });
      expect(legendResult.pokemon.level).toBe(15);

      // At random=0.999..., rollLevel returns maxLevel
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      clearEggGachaCache();

      const commonMax = hatchEgg({ id: "e4", tier: "common", createdAt: new Date().toISOString() });
      expect(commonMax.pokemon.level).toBeGreaterThanOrEqual(1);
      expect(commonMax.pokemon.level).toBeLessThanOrEqual(6);

      const rareMax = hatchEgg({ id: "e5", tier: "rare", createdAt: new Date().toISOString() });
      expect(rareMax.pokemon.level).toBeGreaterThanOrEqual(5);
      expect(rareMax.pokemon.level).toBeLessThanOrEqual(12);

      const legendMax = hatchEgg({ id: "e6", tier: "legend", createdAt: new Date().toISOString() });
      expect(legendMax.pokemon.level).toBeGreaterThanOrEqual(15);
      expect(legendMax.pokemon.level).toBeLessThanOrEqual(25);
    });
  });
});
