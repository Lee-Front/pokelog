import { describe, expect, it } from "vitest";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { getDamageTakenTotal, normalizeDamageTakenTotal, recordDamageTaken } from "../../src/game/battle-progress.js";

describe("battle-progress", () => {
  it("normalizes missing damage totals to zero", () => {
    expect(normalizeDamageTakenTotal(undefined)).toBe(0);
    expect(normalizeDamageTakenTotal(null)).toBe(0);
  });

  it("records cumulative damage taken on owned Pokemon", () => {
    const pokemon = createPokemon("yamask", 20);

    expect(recordDamageTaken(pokemon, 12)).toBe(12);
    expect(recordDamageTaken(pokemon, 8)).toBe(20);
    expect(getDamageTakenTotal(pokemon.damageTakenTotal)).toBe(20);
  });
});
