import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStats, buildStatsForPokemon, calculateStatsForLevel } from "../../src/game/pokemon-stats.js";
import type { IndividualValues, SpeciesData } from "../../../../shared/types.js";
import * as dataLoader from "../../src/game/data-loader.js";
import * as pokemonState from "../../src/game/pokemon-state.js";

function stubSpecies(overrides: Partial<SpeciesData> = {}): SpeciesData {
  return {
    id: 1,
    species: "bulbasaur",
    name: "Bulbasaur",
    types: ["grass", "poison"],
    baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 },
    catchRate: 45,
    expGroup: "medium-slow",
    learnset: { levelUp: {}, tm: [], tutor: [], egg: [], event: [] },
    maxMoves: 4,
    ...overrides,
  };
}

const ALL_31: IndividualValues = { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 };
const ALL_0: IndividualValues = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };

describe("IV-aware buildStats", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);
  });

  it("IV 31 vs 0 yields a significant stat difference at level 50", () => {
    const species = stubSpecies();
    const with31 = buildStats(species, 50, undefined, null, ALL_31);
    const with0 = buildStats(species, 50, undefined, null, ALL_0);

    // HP formula: floor((2*base + iv) * level / 100) + level + 10
    // base 45, lvl 50, iv 31 → floor((90+31)*50/100) + 60 = floor(60.5)+60 = 60+60 = 120
    expect(with31.maxHp).toBe(120);
    // iv 0 → floor(90*50/100)+60 = 45+60 = 105
    expect(with0.maxHp).toBe(105);
    // Difference at lvl 50 should be ~15 HP
    expect(with31.maxHp - with0.maxHp).toBe(15);

    // Attack: iv 31 → floor((98+31)*50/100)+5 = floor(64.5)+5 = 64+5 = 69
    expect(with31.stats.attack).toBe(69);
    // Attack: iv 0 → floor(98*50/100)+5 = 49+5 = 54
    expect(with0.stats.attack).toBe(54);
    expect(with31.stats.attack).toBeGreaterThan(with0.stats.attack);
  });

  it("Legacy pokemon (ivs === undefined) yields identical stats to pre-IV formula", () => {
    // Baseline: Bulbasaur @ Lv50 under the old formula = HP 105, attack 54, spAttack 70, speed 50.
    const species = stubSpecies();

    const legacy = buildStats(species, 50);
    expect(legacy.maxHp).toBe(105);
    expect(legacy.stats.attack).toBe(54);
    expect(legacy.stats.defense).toBe(54);
    expect(legacy.stats.spAttack).toBe(70);
    expect(legacy.stats.spDefense).toBe(70);
    expect(legacy.stats.speed).toBe(50);

    // Should match IV=0 (legacy fallback)
    const iv0 = buildStats(species, 50, undefined, null, ALL_0);
    expect(legacy.maxHp).toBe(iv0.maxHp);
    expect(legacy.stats).toEqual(iv0.stats);
  });

  it("HP formula correctness at various levels", () => {
    const species = stubSpecies({ baseStats: { hp: 100, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 } });

    // lvl 1, IV 31: floor((200+31)*1/100) + 1 + 10 = floor(2.31)+11 = 2+11 = 13
    expect(buildStats(species, 1, undefined, null, ALL_31).maxHp).toBe(13);
    // lvl 100, IV 31: floor((200+31)*100/100) + 110 = 231+110 = 341
    expect(buildStats(species, 100, undefined, null, ALL_31).maxHp).toBe(341);
    // lvl 100, IV 0 : floor(200*100/100) + 110 = 200+110 = 310
    expect(buildStats(species, 100, undefined, null, ALL_0).maxHp).toBe(310);
  });

  it("Non-HP formula correctness (attack)", () => {
    const species = stubSpecies({ baseStats: { hp: 50, attack: 80, defense: 50, spAttack: 50, spDefense: 50, speed: 50 } });
    // lvl 50, IV 31: floor((160+31)*50/100)+5 = floor(95.5)+5 = 95+5 = 100
    expect(buildStats(species, 50, undefined, null, ALL_31).stats.attack).toBe(100);
    // lvl 50, IV 0 : floor(160*50/100)+5 = 80+5 = 85
    expect(buildStats(species, 50, undefined, null, ALL_0).stats.attack).toBe(85);
  });

  it("Partial IV object uses missing values as 0", () => {
    const species = stubSpecies();
    const partial: IndividualValues = { hp: 31, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
    const full0: IndividualValues = ALL_0;

    const fullHp = buildStats(species, 50, undefined, null, partial);
    const zeroHp = buildStats(species, 50, undefined, null, full0);
    // HP differs by 15, non-HP stats equal.
    expect(fullHp.maxHp).toBe(zeroHp.maxHp + 15);
    expect(fullHp.stats).toEqual(zeroHp.stats);
  });
});

describe("buildStatsForPokemon with IVs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates pokemon.ivs into the stat calculation", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const pokemon = { species: "bulbasaur", level: 50, nature: undefined, variantId: null, ivs: ALL_31 };
    const result = buildStatsForPokemon(pokemon);

    expect(result.maxHp).toBe(120);
    expect(result.stats.attack).toBe(69);
  });

  it("leaves stats unchanged for pokemon lacking ivs", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    // Legacy shape (no ivs field): TS Pick type allows ivs undefined.
    const pokemon = { species: "bulbasaur", level: 50, nature: undefined, variantId: null };
    const result = buildStatsForPokemon(pokemon as Parameters<typeof buildStatsForPokemon>[0]);

    expect(result.maxHp).toBe(105);
    expect(result.stats.attack).toBe(54);
  });
});

describe("calculateStatsForLevel with IVs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts optional ivs and returns boosted stats", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const withIvs = calculateStatsForLevel("bulbasaur", 50, undefined, null, ALL_31);
    const legacy = calculateStatsForLevel("bulbasaur", 50);

    expect(withIvs.maxHp).toBe(120);
    expect(legacy.maxHp).toBe(105);
  });
});
