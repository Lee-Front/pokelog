import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllCaches, getEvolutions, getSpeciesByName, getVariants } from "../../src/game/data-loader.js";
import { clearEggGachaCache, getEggTierSummaries, hatchEgg, getEggTierPool } from "../../src/game/egg-gacha.js";
import { resolveSpeciesOrVariant } from "../../src/game/pokemon-state.js";

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
  it("builds tier summaries from synced species data", async () => {
    const summaries = await getEggTierSummaries();
    expect(summaries.map((entry) => entry.tier)).toEqual(["common", "rare", "legend"]);
    expect(summaries.every((entry) => entry.speciesCount > 0)).toBe(true);
    expect(summaries.map((entry) => entry.cost)).toEqual([120, 450, 3200]);
  });

  it("hatches common eggs from easy base-stage species", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await hatchEgg({ id: "egg-common", tier: "common", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(species!.isBaby).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(false);
    expect(species!.rawCaptureRate).toBeGreaterThanOrEqual(120);
    expect(result.pokemon.level).toBe(1);
  });

  it("hatches rare eggs from baby or low-capture base-stage species", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await hatchEgg({ id: "egg-rare", tier: "rare", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(false);
    expect(Boolean(species!.isBaby || (species!.rawCaptureRate ?? 0) < 120)).toBe(true);
    expect(result.pokemon.level).toBe(5);
  });

  it("hatches legend eggs from legendary or mythical base-stage species", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await hatchEgg({ id: "egg-legend", tier: "legend", createdAt: new Date().toISOString() });
    const species = getSpeciesByName(result.pokemon.species);

    expect(species).toBeDefined();
    expect(getPreEvolutionTargets().has(result.pokemon.species)).toBe(false);
    expect(Boolean(species!.isLegendary || species!.isMythical)).toBe(true);
    expect(result.pokemon.level).toBe(15);
  });

  it("includes egg-eligible regional variants in tier pools", async () => {
    const commonPool = await getEggTierPool("common");
    const poolSlugs = new Set(commonPool.map((entry) => entry.species));
    // a variant whose base species (diglett) is an easy common-tier base stage
    expect(poolSlugs.has("diglett-alola")).toBe(true);
  });

  it("excludes variants whose base species is a line-evolved (non-base-stage) form", async () => {
    const allPoolSlugs = new Set<string>();
    for (const tier of ["common", "rare", "legend"] as const) {
      for (const entry of await getEggTierPool(tier)) allPoolSlugs.add(entry.species);
    }
    // arcanine evolves from growlithe, so arcanine-hisui must never be an egg candidate
    expect(allPoolSlugs.has("arcanine-hisui")).toBe(false);
  });

  it("every variant entry in egg pools resolves to a known base species", async () => {
    const variantIds = new Set(getVariants().map((variant) => variant.id));
    for (const tier of ["common", "rare", "legend"] as const) {
      for (const entry of await getEggTierPool(tier)) {
        if (variantIds.has(entry.species)) {
          const resolved = resolveSpeciesOrVariant(entry.species);
          expect(resolved.variantId).toBe(entry.species);
          expect(resolved.speciesData).not.toBeNull();
        }
      }
    }
  });

  it("hatches a variant egg into a Pokemon carrying the variantId", async () => {
    // force the weighted roll to land on the last pool entry, which is a variant
    // (variants are appended after base species in buildTierPool)
    vi.spyOn(Math, "random").mockReturnValue(0.999999);

    const pool = await getEggTierPool("common");
    const lastEntry = pool[pool.length - 1];
    expect(getVariants().some((variant) => variant.id === lastEntry.species)).toBe(true);

    const result = await hatchEgg({ id: "egg-variant", tier: "common", createdAt: new Date().toISOString() });
    expect(result.pokemon.variantId).toBe(lastEntry.species);
    const resolved = resolveSpeciesOrVariant(lastEntry.species);
    expect(result.pokemon.species).toBe(resolved.baseSpecies);
  });

  it("variants are rarer than their base species in the same egg pool", async () => {
    const pool = await getEggTierPool("common");
    const diglett = pool.find((entry) => entry.species === "diglett");
    const diglettAlola = pool.find((entry) => entry.species === "diglett-alola");
    expect(diglett).toBeDefined();
    expect(diglettAlola).toBeDefined();
    expect(diglettAlola!.weight).toBeLessThan(diglett!.weight);
  });
});
