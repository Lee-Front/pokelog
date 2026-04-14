import { describe, expect, it } from "vitest";
import { evolvePokemon } from "../../src/game/growth.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

function createOwnedPokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "test-uid",
    species: "charmander",
    nickname: null,
    level: 5,
    exp: 0,
    hp: 30,
    maxHp: 30,
    stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
    moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
    caughtAt: "2024-01-01T00:00:00Z",
    gender: null,
    friendship: 70,
    heldItem: null,
    abilityId: null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: "adamant",
    ...overrides,
  };
}

describe("evolvePokemon with targetVariantId", () => {
  it("sets variantId when targetVariantId is provided", () => {
    const pokemon = createOwnedPokemon();
    evolvePokemon(pokemon, "charmeleon", "alolan");
    expect(pokemon.species).toBe("charmeleon");
    expect(pokemon.variantId).toBe("alolan");
  });

  it("clears variantId when targetVariantId is null", () => {
    const pokemon = createOwnedPokemon({ variantId: "galarian" });
    expect(pokemon.variantId).toBe("galarian");
    evolvePokemon(pokemon, "charmeleon", null);
    expect(pokemon.variantId).toBeNull();
  });

  it("clears variantId when targetVariantId is not provided", () => {
    const pokemon = createOwnedPokemon({ variantId: "galarian" });
    expect(pokemon.variantId).toBe("galarian");
    evolvePokemon(pokemon, "charmeleon");
    expect(pokemon.variantId).toBeNull();
  });

  it("preserves other fields during variant evolution", () => {
    const pokemon = createOwnedPokemon({
      nickname: "Flame",
      friendship: 150,
      nature: "adamant",
      moveUsageCounts: { scratch: 10 },
      damageTakenTotal: 42,
      gender: "male",
      heldItem: "charcoal",
      isShiny: true,
    });

    evolvePokemon(pokemon, "charmeleon", "alolan");

    expect(pokemon.species).toBe("charmeleon");
    expect(pokemon.variantId).toBe("alolan");
    expect(pokemon.nickname).toBe("Flame");
    expect(pokemon.friendship).toBe(150);
    expect(pokemon.nature).toBe("adamant");
    expect(pokemon.moveUsageCounts).toEqual({ scratch: 10 });
    expect(pokemon.damageTakenTotal).toBe(42);
    expect(pokemon.gender).toBe("male");
    expect(pokemon.heldItem).toBe("charcoal");
    expect(pokemon.isShiny).toBe(true);
    expect(pokemon.level).toBe(5);
    expect(pokemon.exp).toBe(0);
    expect(pokemon.moves).toEqual([{ id: "scratch", pp: 35, maxPp: 35 }]);
    expect(pokemon.caughtAt).toBe("2024-01-01T00:00:00Z");
  });
});
