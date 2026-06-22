import { describe, it, expect } from "vitest";
import { selectWildPokemon } from "../../src/game/encounter.js";
import type { RegionData } from "../../../../shared/types.js";

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
