import { describe, it, expect } from "vitest";
import { incrementItem, decrementItem, healPokemon } from "../../src/game/inventory-utils.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

function makePokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "test-uid",
    species: "bulbasaur",
    nickname: null,
    level: 5,
    exp: 0,
    hp: 10,
    maxHp: 20,
    stats: { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 },
    moves: [
      { id: "tackle", pp: 20, maxPp: 35 },
      { id: "growl", pp: 30, maxPp: 40 },
    ],
    caughtAt: "2026-01-01",
    ...overrides,
  };
}

describe("incrementItem", () => {
  it("adds a new item to an empty inventory", () => {
    const inv: Record<string, number> = {};
    incrementItem(inv, "potion");
    expect(inv).toEqual({ potion: 1 });
  });

  it("increments an existing item count", () => {
    const inv: Record<string, number> = { potion: 3 };
    incrementItem(inv, "potion");
    expect(inv.potion).toBe(4);
  });

  it("increments by a custom quantity", () => {
    const inv: Record<string, number> = { potion: 2 };
    incrementItem(inv, "potion", 5);
    expect(inv.potion).toBe(7);
  });

  it("does not affect other items", () => {
    const inv: Record<string, number> = { potion: 3, "poke-ball": 10 };
    incrementItem(inv, "potion", 2);
    expect(inv.potion).toBe(5);
    expect(inv["poke-ball"]).toBe(10);
  });
});

describe("decrementItem", () => {
  it("decrements an existing item", () => {
    const inv: Record<string, number> = { potion: 5 };
    decrementItem(inv, "potion");
    expect(inv.potion).toBe(4);
  });

  it("decrements by a custom quantity", () => {
    const inv: Record<string, number> = { potion: 10 };
    decrementItem(inv, "potion", 3);
    expect(inv.potion).toBe(7);
  });

  it("deletes the key when count reaches zero", () => {
    const inv: Record<string, number> = { potion: 1 };
    decrementItem(inv, "potion");
    expect(inv).not.toHaveProperty("potion");
  });

  it("deletes the key when count goes below zero", () => {
    const inv: Record<string, number> = { potion: 1 };
    decrementItem(inv, "potion", 5);
    expect(inv).not.toHaveProperty("potion");
  });

  it("deletes key when decrementing a nonexistent item (treated as 0)", () => {
    const inv: Record<string, number> = {};
    decrementItem(inv, "potion");
    expect(inv).not.toHaveProperty("potion");
  });
});

describe("healPokemon", () => {
  it("heals by a partial amount capped at maxHp", () => {
    const pokemon = makePokemon({ hp: 10, maxHp: 20 });
    healPokemon(pokemon, 5);
    expect(pokemon.hp).toBe(15);
  });

  it("caps hp at maxHp when heal amount would exceed it", () => {
    const pokemon = makePokemon({ hp: 18, maxHp: 20 });
    healPokemon(pokemon, 10);
    expect(pokemon.hp).toBe(20);
  });

  it("fully heals hp when no amount is given", () => {
    const pokemon = makePokemon({ hp: 5, maxHp: 20 });
    healPokemon(pokemon);
    expect(pokemon.hp).toBe(20);
  });

  it("restores move pp to maxPp on full heal", () => {
    const pokemon = makePokemon();
    healPokemon(pokemon);
    expect(pokemon.moves[0].pp).toBe(35);
    expect(pokemon.moves[1].pp).toBe(40);
  });

  it("clears statusCondition on full heal", () => {
    const pokemon = makePokemon({ statusCondition: "poison" });
    healPokemon(pokemon);
    expect(pokemon.statusCondition).toBeNull();
  });

  it("clears sleepTurns on full heal", () => {
    const pokemon = makePokemon({ sleepTurns: 3 });
    healPokemon(pokemon);
    expect(pokemon.sleepTurns).toBeUndefined();
  });

  it("does not clear status or restore pp on partial heal", () => {
    const pokemon = makePokemon({
      hp: 10,
      maxHp: 20,
      statusCondition: "burn",
      sleepTurns: 2,
    });
    pokemon.moves[0].pp = 5;
    healPokemon(pokemon, 3);
    expect(pokemon.hp).toBe(13);
    expect(pokemon.statusCondition).toBe("burn");
    expect(pokemon.sleepTurns).toBe(2);
    expect(pokemon.moves[0].pp).toBe(5);
  });
});
