import { describe, it, expect, vi, afterEach } from "vitest";
import { selectWildPokemon, scaleWildLevel } from "./encounter.js";
import type { RegionData } from "../../../../shared/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scaleWildLevel", () => {
  it("falls back to the species-rolled level for an empty party (new user)", () => {
    expect(scaleWildLevel(5, [], 3)).toBe(5);
  });

  it("anchors on the party's highest level", () => {
    // jitter midpoint (Math.random -> 0.5 gives jitter 0)
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(scaleWildLevel(5, [10, 25, 18], 1)).toBe(25);
  });

  it("scales up as the party grows stronger", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const weak = scaleWildLevel(5, [8], 1);
    const strong = scaleWildLevel(5, [40], 1);
    expect(strong).toBeGreaterThan(weak);
  });

  it("stays within ±3 of the party anchor across the jitter range", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const level = scaleWildLevel(5, [30], 1);
      expect(level).toBeGreaterThanOrEqual(27);
      expect(level).toBeLessThanOrEqual(33);
      vi.restoreAllMocks();
    }
  });

  it("never drops below the species' natural floor", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // jitter -3
    // anchor 5 - 3 = 2, but floor is 15
    expect(scaleWildLevel(5, [5], 15)).toBe(15);
  });

  it("clamps the floor to at least 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // jitter -3
    expect(scaleWildLevel(5, [1], 0)).toBe(1);
  });

  it("caps at level 100", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // jitter +3
    expect(scaleWildLevel(5, [100], 1)).toBe(100);
  });
});

describe("selectWildPokemon", () => {
  const region: RegionData = {
    name: "test",
    encounters: [
      { species: "pidgey", weight: 1, levelRange: [4, 8] },
      { species: "rattata", weight: 1, levelRange: [10, 12] },
    ],
  };

  it("returns the species floor as minLevel for the rolled entry", () => {
    // roll picks the first entry
    vi.spyOn(Math, "random").mockReturnValue(0);
    const pick = selectWildPokemon(region);
    expect(pick.species).toBe("pidgey");
    expect(pick.minLevel).toBe(4);
    expect(pick.level).toBe(4);
  });

  it("rolls a level inside the entry's levelRange", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const pick = selectWildPokemon(region);
    expect(pick.level).toBeGreaterThanOrEqual(pick.minLevel);
  });
});
