import { afterEach, describe, expect, it, vi } from "vitest";
import { createPokemon } from "../../src/game/pokemon-factory.js";

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
});
