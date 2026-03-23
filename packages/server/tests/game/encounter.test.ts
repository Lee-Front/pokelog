import { describe, it, expect, vi } from "vitest";
import { checkEncounter, selectWildPokemon } from "../../src/game/encounter.js";
import type { RegionData } from "../../../../shared/types.js";

describe("checkEncounter", () => {
  it("accumulates bytes in ceiling", () => {
    // baseChance=0 so probability never triggers, ceilingBytes very high
    const result = checkEncounter(0, 100, 0, 1, 10000);
    expect(result.encountered).toBe(false);
    expect(result.newCeiling).toBe(100);
  });

  it("triggers encounter and resets ceiling when ceiling reached", () => {
    // ceiling=900, add 200 => 1100 >= 1000
    const result = checkEncounter(900, 200, 0, 1, 1000);
    expect(result.encountered).toBe(true);
    expect(result.newCeiling).toBe(0);
  });

  it("triggers encounter on probability (baseChance=1 guarantees)", () => {
    const result = checkEncounter(0, 50, 1, 1, 10000);
    expect(result.encountered).toBe(true);
    expect(result.newCeiling).toBe(0);
  });

  it("does not trigger encounter when probability is 0 and ceiling not met", () => {
    const result = checkEncounter(0, 50, 0, 1, 10000);
    expect(result.encountered).toBe(false);
    expect(result.newCeiling).toBe(50);
  });

  it("combo multiplier boosts base chance", () => {
    // baseChance=0.4, comboMultiplier=3 => effective chance = 1.2, capped >= 1 always triggers
    const result = checkEncounter(0, 10, 0.4, 3, 10000);
    expect(result.encountered).toBe(true);
    expect(result.newCeiling).toBe(0);
  });

  it("resets ceiling to 0 on encounter from either trigger", () => {
    // Both ceiling and probability trigger
    const result = checkEncounter(990, 100, 1, 1, 1000);
    expect(result.encountered).toBe(true);
    expect(result.newCeiling).toBe(0);
  });
});

describe("selectWildPokemon", () => {
  const regionData: RegionData = {
    name: "test",
    encounters: [
      { species: "pidgey", weight: 100, levelRange: [2, 5] },
      { species: "pikachu", weight: 0, levelRange: [3, 7] },
    ],
  };

  it("returns a species from the encounter table", () => {
    const result = selectWildPokemon(regionData);
    expect(result.species).toBe("pidgey"); // pikachu has weight 0
  });

  it("returns a level within the species level range", () => {
    const singleSpecies: RegionData = {
      name: "test",
      encounters: [
        { species: "rattata", weight: 1, levelRange: [10, 15] },
      ],
    };
    for (let i = 0; i < 20; i++) {
      const result = selectWildPokemon(singleSpecies);
      expect(result.species).toBe("rattata");
      expect(result.level).toBeGreaterThanOrEqual(10);
      expect(result.level).toBeLessThanOrEqual(15);
    }
  });
});
