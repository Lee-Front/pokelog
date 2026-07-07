import { afterEach, describe, expect, it, vi } from "vitest";
import { createPokemon, createWildPokemon, wildPokemonToOwned } from "../../src/game/pokemon-factory.js";
import { getExpForLevelInGroup, getSpeciesExpGroup } from "../../src/game/growth.js";

describe("createPokemon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns female gender when the species roll lands in the female rate", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2);

    const pokemon = createPokemon("burmy", 10);

    expect(pokemon.gender).toBe("female");
  });

  it("assigns male gender when the species roll lands outside the female rate", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.8);

    const pokemon = createPokemon("burmy", 10);

    expect(pokemon.gender).toBe("male");
  });

  it("assigns genderless when the species has no gender", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2);

    const pokemon = createPokemon("magnemite", 10);

    expect(pokemon.gender).toBe("genderless");
  });

  it("returns a complete OwnedPokemon structure with correct defaults", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const pokemon = createPokemon("bulbasaur", 5);

    expect(pokemon.uid).toEqual(expect.any(String));
    expect(pokemon.species).toBe("bulbasaur");
    expect(pokemon.level).toBe(5);
    // 본가식: 레벨에 맞는 누적 경험치로 초기화한다(과거 exp:0 버그 수정). bulbasaur는
    // medium-slow 곡선이므로 세제곱이 아니라 종별 성장곡선 값을 쓴다.
    expect(pokemon.exp).toBe(getExpForLevelInGroup(getSpeciesExpGroup(pokemon.species), pokemon.level));
    expect(pokemon.hp).toBe(pokemon.maxHp);
    expect(typeof pokemon.nature).toBe("string");
    expect(typeof pokemon.isShiny).toBe("boolean");
    expect(typeof pokemon.friendship).toBe("number");
    expect(typeof pokemon.abilityId).toBe("string");
    expect(pokemon.moveUsageCounts).toEqual({});
    expect(pokemon.damageTakenTotal).toBe(0);
  });

  it("throws an Error for an unknown species", () => {
    expect(() => createPokemon("fakemon", 5)).toThrow("Unknown species: fakemon");
  });
});

describe("createWildPokemon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns correct WildPokemon structure", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const wild = createWildPokemon("rattata", 3);

    expect(wild.species).toBe("rattata");
    expect(wild.level).toBe(3);
    expect(wild.hp).toBe(wild.maxHp);
    expect(typeof wild.nature).toBe("string");
    expect(wild.gender).toEqual(expect.stringMatching(/^(male|female|genderless)$/));
    expect(wild.ability).toEqual(expect.any(String));
  });

  it("throws an Error for an unknown species", () => {
    expect(() => createWildPokemon("fakemon", 5)).toThrow("Unknown species: fakemon");
  });

  it("applies variant baseStatsOverride for arcanine-hisui", () => {
    // Use a fixed random to get a neutral nature (hardy) so stats are predictable
    vi.spyOn(Math, "random").mockReturnValue(0.0);

    const base = createWildPokemon("arcanine", 50);
    const variant = createWildPokemon("arcanine-hisui", 50);

    // arcanine-hisui overrides: hp 90→95, attack 110→115, spAttack 100→95, speed 95→90
    // defense and spDefense remain unchanged at 80
    expect(variant.variantId).toBe("arcanine-hisui");
    expect(variant.species).toBe("arcanine");

    // HP should differ because base hp changed from 90 to 95
    expect(variant.maxHp).toBeGreaterThan(base.maxHp);

    // Attack should be higher (110→115)
    expect(variant.stats.attack).toBeGreaterThan(base.stats.attack);

    // Speed should be lower (95→90)
    expect(variant.stats.speed).toBeLessThan(base.stats.speed);

    // Defense should be the same (not overridden)
    expect(variant.stats.defense).toBe(base.stats.defense);
    expect(variant.stats.spDefense).toBe(base.stats.spDefense);
  });

  it("includes isShiny field", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const wild = createWildPokemon("rattata", 3);
    expect(typeof wild.isShiny).toBe("boolean");
  });
});

describe("wildPokemonToOwned", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves all fields from the wild pokemon", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const wild = createWildPokemon("bulbasaur", 10);
    // Simulate battle damage
    wild.hp = 5;

    const owned = wildPokemonToOwned(wild);

    expect(owned.species).toBe(wild.species);
    expect(owned.level).toBe(wild.level);
    expect(owned.hp).toBe(5); // preserves battle HP
    expect(owned.maxHp).toBe(wild.maxHp);
    expect(owned.stats).toEqual(wild.stats);
    expect(owned.moves).toEqual(wild.moves);
    expect(owned.nature).toBe(wild.nature);
    expect(owned.gender).toBe(wild.gender);
    expect(owned.isShiny).toBe(wild.isShiny);
    expect(owned.variantId).toBe(wild.variantId);
    expect(owned.uid).toEqual(expect.any(String));
    expect(owned.caughtAt).toEqual(expect.any(String));
    // 종별 성장곡선(bulbasaur=medium-slow) 기준 누적 경험치로 초기화.
    expect(owned.exp).toBe(getExpForLevelInGroup(getSpeciesExpGroup(owned.species), owned.level));
  });

  it("preserves variantId from a variant wild pokemon", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const wild = createWildPokemon("arcanine-hisui", 30);
    const owned = wildPokemonToOwned(wild);

    expect(owned.variantId).toBe("arcanine-hisui");
    expect(owned.species).toBe("arcanine");
    expect(owned.stats).toEqual(wild.stats);
    expect(owned.maxHp).toBe(wild.maxHp);
  });
});
