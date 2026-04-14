import { afterEach, describe, expect, it, vi } from "vitest";
import { createPokemon, createWildPokemon } from "../../src/game/pokemon-factory.js";

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
    expect(pokemon.exp).toBe(0);
    expect(pokemon.hp).toBe(pokemon.maxHp);
    expect(typeof pokemon.nature).toBe("string");
    expect(typeof pokemon.isShiny).toBe("boolean");
    expect(typeof pokemon.friendship).toBe("number");
    expect(typeof pokemon.abilityId).toBe("string");
    expect(pokemon.tradeLocked).toBe(false);
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
});
