import { describe, it, expect, vi, afterEach } from "vitest";
import { selectWildPokemon } from "./encounter.js";
import type { RegionData } from "../../../../shared/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selectWildPokemon", () => {
  const region: RegionData = {
    name: "test",
    encounters: [
      { species: "pidgey", weight: 1, levelRange: [4, 8] },
      { species: "rattata", weight: 1, levelRange: [10, 12] },
    ],
  };

  it("returns the rolled entry's species at its floor when random is 0", () => {
    // roll picks the first entry; level roll floors to the range minimum
    vi.spyOn(Math, "random").mockReturnValue(0);
    const pick = selectWildPokemon(region);
    expect(pick.species).toBe("pidgey");
    expect(pick.level).toBe(4);
  });

  it("rolls a level within the chosen entry's levelRange (species-natural)", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const pick = selectWildPokemon(region);
      const entry = region.encounters.find((e) => e.species === pick.species)!;
      const [min, max] = entry.levelRange;
      expect(pick.level).toBeGreaterThanOrEqual(min);
      expect(pick.level).toBeLessThanOrEqual(max);
      vi.restoreAllMocks();
    }
  });

  it("does not take or depend on any party input", () => {
    // selectWildPokemon takes only region data — the level is species-natural,
    // never scaled to the player's party.
    expect(selectWildPokemon.length).toBe(1);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const pick = selectWildPokemon(region);
    expect(pick.species).toBe("rattata");
    expect(pick.level).toBe(12);
  });
});
