import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, getEvolutions, getSpeciesByName } from "../../src/game/data-loader.js";
import { clearEggGachaCache, getEggTierSummaries, hatchEgg } from "../../src/game/egg-gacha.js";

function getPreEvolutionTargets(): Set<string> {
  const targets = new Set<string>();
  for (const evolution of Object.values(getEvolutions())) {
    for (const branch of evolution.branches) {
      targets.add(branch.targetSpecies);
    }
  }
  return targets;
}

beforeEach(() => {
  clearAllCaches();
  clearEggGachaCache();
  vi.restoreAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("egg-gacha", () => {
  it("builds tier summaries from synced species data", () => {
    const summaries = getEggTierSummaries();
    expect(summaries.map((entry) => entry.tier)).toEqual(["common", "rare", "epic", "legend", "manaphy"]);
    expect(summaries.every((entry) => entry.speciesCount > 0)).toBe(true);
    expect(summaries.map((entry) => entry.cost)).toEqual([120, 450, 1200, 3200, 5000]);
  });

  it("hatches common eggs from easy base-stage species", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = hatchEgg({ id: "egg-common", tier: "common", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(species!.isBaby).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(false);
    expect(species!.rawCaptureRate).toBeGreaterThanOrEqual(120);
    expect(result.pokemon.level).toBe(1);
  });

  it("hatches rare eggs from baby or mid-capture base-stage species", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = hatchEgg({ id: "egg-rare", tier: "rare", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(false);
    expect(result.pokemon.level).toBe(5);
  });

  it("hatches epic eggs from pseudo-legendary or very rare base-stage species", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = hatchEgg({ id: "egg-epic", tier: "epic", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(false);
    expect(result.pokemon.level).toBe(10);
  });

  it("hatches manaphy eggs yielding manaphy or phione", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = hatchEgg({ id: "egg-manaphy", tier: "manaphy", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(["manaphy", "phione"]).toContain(result.pokemon.species);
    expect(result.pokemon.level).toBe(1);
  });

  it("hatches legend eggs from legendary or mythical base-stage species", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = hatchEgg({ id: "egg-legend", tier: "legend", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(true);
    expect(result.pokemon.level).toBe(15);
  });
});
