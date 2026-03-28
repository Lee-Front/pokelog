import { describe, it, expect, beforeEach } from "vitest";
import { getSpecies, getSpeciesByName, getMoves, getMoveById, getTypeChart, getRegion, getEvolutions, clearAllCaches } from "../../src/game/data-loader.js";

beforeEach(() => clearAllCaches());

describe("data-loader", () => {
  it("loads all species", () => {
    const species = getSpecies();
    expect(species.length).toBeGreaterThan(0);
    expect(species[0]).toHaveProperty("species");
    expect(species[0]).toHaveProperty("baseStats");
  });

  it("finds species by name", () => {
    const bulbasaur = getSpeciesByName("bulbasaur");
    expect(bulbasaur).toBeDefined();
    expect(bulbasaur!.name).toBe("이상해씨");
  });

  it("loads all moves", () => {
    const moves = getMoves();
    expect(moves.length).toBeGreaterThan(0);
  });

  it("finds move by id", () => {
    const tackle = getMoveById("tackle");
    expect(tackle).toBeDefined();
    expect(tackle!.power).toBeGreaterThan(0);
  });

  it("loads type chart", () => {
    const chart = getTypeChart();
    expect(chart).toHaveProperty("fire");
  });

  it("loads default region", () => {
    const region = getRegion("default");
    expect(region.encounters.length).toBeGreaterThan(0);
  });

  it("loads evolution data", () => {
    const evos = getEvolutions();
    expect(Object.keys(evos).length).toBeGreaterThan(0);
  });
});
