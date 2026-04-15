import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyNatureModifier, buildStats, calculateStatsForLevel, buildStatsForPokemon } from "../../src/game/pokemon-stats.js";
import type { PokemonStats, SpeciesData, NatureData } from "../../../../shared/types.js";
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

describe("applyNatureModifier", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("boosts the increased stat by 1.1x (floored)", () => {
    const nature: NatureData = { id: "adamant", name: "Adamant", increasedStat: "attack", decreasedStat: "spAttack" };
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(nature);

    const stats: PokemonStats = { attack: 100, defense: 80, speed: 70, spAttack: 90, spDefense: 85 };
    applyNatureModifier(stats, "adamant");

    expect(stats.attack).toBe(Math.floor(100 * 1.1)); // 110
    expect(stats.spAttack).toBe(Math.floor(90 * 0.9)); // 81
  });

  it("reduces the decreased stat by 0.9x (floored)", () => {
    const nature: NatureData = { id: "modest", name: "Modest", increasedStat: "spAttack", decreasedStat: "attack" };
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(nature);

    const stats: PokemonStats = { attack: 100, defense: 80, speed: 70, spAttack: 90, spDefense: 85 };
    applyNatureModifier(stats, "modest");

    expect(stats.attack).toBe(Math.floor(100 * 0.9)); // 90
    expect(stats.spAttack).toBe(Math.floor(90 * 1.1)); // 99
  });

  it("does nothing for a neutral nature (no increase/decrease)", () => {
    const nature: NatureData = { id: "hardy", name: "Hardy", increasedStat: null, decreasedStat: null };
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(nature);

    const stats: PokemonStats = { attack: 100, defense: 80, speed: 70, spAttack: 90, spDefense: 85 };
    const original = { ...stats };
    applyNatureModifier(stats, "hardy");

    expect(stats).toEqual(original);
  });

  it("does nothing when nature is undefined", () => {
    const stats: PokemonStats = { attack: 100, defense: 80, speed: 70, spAttack: 90, spDefense: 85 };
    const original = { ...stats };
    applyNatureModifier(stats, undefined);
    expect(stats).toEqual(original);
  });

  it("does nothing when nature is not found in data", () => {
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);

    const stats: PokemonStats = { attack: 100, defense: 80, speed: 70, spAttack: 90, spDefense: 85 };
    const original = { ...stats };
    applyNatureModifier(stats, "unknown-nature");

    expect(stats).toEqual(original);
  });
});

describe("buildStats", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates HP using floor(baseHp*2*level/100) + level + 10", () => {
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const species = stubSpecies({ baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 } });
    const result = buildStats(species, 50);

    // HP = floor(45*2*50/100) + 50 + 10 = floor(45) + 60 = 105
    expect(result.maxHp).toBe(105);
  });

  it("calculates other stats using floor(baseStat*2*level/100) + 5", () => {
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const species = stubSpecies({ baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 } });
    const result = buildStats(species, 50);

    // attack = floor(49*2*50/100) + 5 = floor(49) + 5 = 54
    expect(result.stats.attack).toBe(54);
    // spAttack = floor(65*2*50/100) + 5 = floor(65) + 5 = 70
    expect(result.stats.spAttack).toBe(70);
    // speed = floor(45*2*50/100) + 5 = floor(45) + 5 = 50
    expect(result.stats.speed).toBe(50);
  });

  it("applies nature modifier to stats", () => {
    const nature: NatureData = { id: "adamant", name: "Adamant", increasedStat: "attack", decreasedStat: "spAttack" };
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(nature);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const species = stubSpecies({ baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 } });
    const result = buildStats(species, 50, "adamant");

    // attack = floor(floor(49*2*50/100)+5 * 1.1) = floor(54 * 1.1) = floor(59.4) = 59
    expect(result.stats.attack).toBe(59);
    // spAttack = floor(floor(65*2*50/100)+5 * 0.9) = floor(70 * 0.9) = floor(63) = 63
    expect(result.stats.spAttack).toBe(63);
  });

  it("uses variant baseStatsOverride when available", () => {
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue({
      id: "bulbasaur-mega",
      baseSpecies: "bulbasaur",
      kind: "battle-form",
      name: "Mega Bulbasaur",
      category: "mega",
      sourceArtSlug: "bulbasaur-mega",
      formSuffix: "-mega",
      encounterEligible: false,
      eggEligible: false,
      baseStatsOverride: { attack: 100 },
    });

    const species = stubSpecies({ baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 } });
    const result = buildStats(species, 50, undefined, "bulbasaur-mega");

    // attack with override: floor(100*2*50/100) + 5 = 100 + 5 = 105
    expect(result.stats.attack).toBe(105);
    // defense stays original: floor(49*2*50/100) + 5 = 54
    expect(result.stats.defense).toBe(54);
  });

  it("works correctly at level 1", () => {
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const species = stubSpecies({ baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 } });
    const result = buildStats(species, 1);

    // HP = floor(45*2*1/100) + 1 + 10 = floor(0.9) + 11 = 0 + 11 = 11
    expect(result.maxHp).toBe(11);
    // attack = floor(49*2*1/100) + 5 = floor(0.98) + 5 = 0 + 5 = 5
    expect(result.stats.attack).toBe(5);
  });

  it("works correctly at level 100", () => {
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const species = stubSpecies({ baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 } });
    const result = buildStats(species, 100);

    // HP = floor(45*2*100/100) + 100 + 10 = 90 + 110 = 200
    expect(result.maxHp).toBe(200);
    // attack = floor(49*2*100/100) + 5 = 98 + 5 = 103
    expect(result.stats.attack).toBe(103);
  });
});

describe("calculateStatsForLevel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on unknown species", () => {
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(undefined);
    expect(() => calculateStatsForLevel("fakemon", 10)).toThrow("Unknown species: fakemon");
  });

  it("returns hp equal to maxHp", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const result = calculateStatsForLevel("bulbasaur", 50);
    expect(result.hp).toBe(result.maxHp);
  });

  it("passes nature and variantId through to buildStats", () => {
    const species = stubSpecies();
    const nature: NatureData = { id: "bold", name: "Bold", increasedStat: "defense", decreasedStat: "attack" };
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(nature);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const result = calculateStatsForLevel("bulbasaur", 50, "bold");
    // defense should be boosted
    // base defense = 49, stat = floor(49*2*50/100)+5 = 54, boosted = floor(54*1.1) = 59
    expect(result.stats.defense).toBe(59);
  });
});

describe("buildStatsForPokemon", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on unknown species", () => {
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(undefined);
    const pokemon = { species: "fakemon", level: 10, nature: undefined, variantId: null };
    expect(() => buildStatsForPokemon(pokemon)).toThrow("Unknown species: fakemon");
  });

  it("uses the pokemon's fields to build stats", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const pokemon = { species: "bulbasaur", level: 50, nature: undefined, variantId: null };
    const result = buildStatsForPokemon(pokemon);

    expect(result.maxHp).toBe(105);
    expect(result.stats.attack).toBe(54);
  });

  it("prefers battleForm over pokemon variantId", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    const getEffectiveVariantSpy = vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const pokemon = { species: "bulbasaur", level: 50, nature: undefined, variantId: "alola" };
    buildStatsForPokemon(pokemon, "mega");

    // battleForm "mega" should be passed instead of variantId "alola"
    expect(getEffectiveVariantSpy).toHaveBeenCalledWith("mega");
  });

  it("falls back to pokemon variantId when no battleForm", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getNatureById").mockReturnValue(undefined);
    const getEffectiveVariantSpy = vi.spyOn(pokemonState, "getEffectiveVariant").mockReturnValue(null);

    const pokemon = { species: "bulbasaur", level: 50, nature: undefined, variantId: "alola" };
    buildStatsForPokemon(pokemon);

    expect(getEffectiveVariantSpy).toHaveBeenCalledWith("alola");
  });
});
