import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllCaches,
  getAbilities,
  getCatchRateOverrides,
  getEvolutions,
  getItems,
  getMoveById,
  getMoves,
  getNatures,
  getRegion,
  getRegionNames,
  getSpecies,
  getSpeciesByName,
  getTypeChart,
  getVariantById,
  getVariants,
  getVariantsByBaseSpecies,
} from "../../src/game/data-loader.js";

beforeEach(() => clearAllCaches());

describe("data-loader", () => {
  it("loads all species", () => {
    const species = getSpecies();
    expect(species.length).toBeGreaterThan(0);
    expect(species[0]).toHaveProperty("species");
    expect(species[0]).toHaveProperty("baseStats");
  });

  it("normalizes species records", () => {
    const bulbasaur = getSpeciesByName("bulbasaur");
    expect(bulbasaur).toBeDefined();
    expect(bulbasaur!.learnset).toHaveProperty("levelUp");
    expect(Array.isArray(bulbasaur!.learnset.tm)).toBe(true);
    expect(Array.isArray(bulbasaur!.learnset.tutor)).toBe(true);
    expect(Array.isArray(bulbasaur!.learnset.egg)).toBe(true);
    expect(Array.isArray(bulbasaur!.learnset.event)).toBe(true);
    expect(bulbasaur!.rawCaptureRate).toBe(45);
    expect(bulbasaur!.baseHappiness).toBe(70);
    expect(bulbasaur!.abilities).toEqual({ normal: ["overgrow"], hidden: "chlorophyll" });
  });

  it("loads all moves", () => {
    const moves = getMoves();
    expect(moves.length).toBeGreaterThan(0);
  });

  it("normalizes move metadata", () => {
    const tackle = getMoveById("tackle");
    expect(tackle).toBeDefined();
    expect(tackle!.power).toBeGreaterThan(0);
    expect(tackle!.priority).toBe(0);
    expect(tackle!.target).toBe("selected-pokemon");
    expect(tackle!.meta).toMatchObject({
      ailment: "none",
      ailmentChance: 0,
      critRate: 0,
      drain: 0,
      flinchChance: 0,
      healing: 0,
      statChance: 0,
    });
    expect(tackle!.statChanges).toEqual([]);
  });

  it("loads type chart", () => {
    const chart = getTypeChart();
    expect(chart).toHaveProperty("fire");
  });

  it("loads default region", () => {
    const region = getRegion("default");
    expect(region.encounters.length).toBeGreaterThan(0);
  });

  it("lists available regions", () => {
    expect(getRegionNames()).toContain("default");
    expect(getRegionNames()).toContain("kanto");
    expect(getRegionNames()).toContain("galar");
    expect(getRegionNames().length).toBeGreaterThan(5);
  });

  it("loads additional region data", () => {
    const region = getRegion("johto");
    expect(region.name).toBe("Johto");
    expect(region.encounters.some((entry) => entry.species === "hoothoot")).toBe(true);
  });

  it("normalizes all region encounter pools", () => {
    for (const regionId of getRegionNames()) {
      const region = getRegion(regionId);
      expect(region.encounters.length).toBeGreaterThanOrEqual(regionId === "default" ? 20 : 19);
      expect(region.encounters.every((entry) => Boolean(getSpeciesByName(entry.species)))).toBe(true);
      expect(
        region.encounters.every((entry) => entry.levelRange[0] >= 1 && entry.levelRange[1] >= entry.levelRange[0]),
      ).toBe(true);
      expect(region.encounters.every((entry) => entry.weight > 0)).toBe(true);
    }
  });

  it("normalizes evolution data", () => {
    const evos = getEvolutions();
    expect(Object.keys(evos).length).toBeGreaterThan(0);
    expect(evos.charmander.branches[0]?.targetSpecies).toBe("charmeleon");
    expect(evos.pikachu.branches[0]?.conditions[0]).toEqual({
      type: "item-use",
      item: "thunder-stone",
    });
  });

  it("loads optional static data stores", () => {
    expect(getAbilities().length).toBeGreaterThan(0);
    expect(getNatures().length).toBe(25);
    expect(getItems().length).toBeGreaterThan(0);
    expect(getCatchRateOverrides()).toEqual({});
  });

  it("loads and classifies variant data", () => {
    const variants = getVariants();
    expect(variants.length).toBeGreaterThan(400);

    const alolanVulpix = getVariantById("vulpix-alola");
    expect(alolanVulpix).toMatchObject({
      baseSpecies: "vulpix",
      kind: "regional",
      encounterEligible: true,
      eggEligible: false,
    });

    const megaCharizard = getVariantById("charizard-mega-x");
    expect(megaCharizard).toMatchObject({
      baseSpecies: "charizard",
      kind: "battle-form",
      encounterEligible: false,
      eggEligible: false,
    });

    const rotomVariants = getVariantsByBaseSpecies("rotom");
    expect(rotomVariants.some((entry) => entry.id === "rotom-heat")).toBe(true);
  });
});
