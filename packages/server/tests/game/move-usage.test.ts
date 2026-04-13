import { describe, expect, it } from "vitest";
import type { OwnedPokemon } from "../../../../shared/types.js";
import { getMoveUsageCount, normalizeMoveUsageCounts, recordMoveUsage } from "../../src/game/move-usage.js";

function createPokemon(): OwnedPokemon {
  return {
    uid: "usage-test",
    species: "primeape",
    nickname: null,
    level: 35,
    exp: 0,
    hp: 100,
    maxHp: 100,
    stats: { attack: 50, defense: 40, speed: 45, spAttack: 30, spDefense: 35 },
    moves: [{ id: "rage-fist", pp: 10, maxPp: 10 }],
    caughtAt: "2026-04-13T00:00:00.000Z",
    gender: "male",
    friendship: 70,
    heldItem: null,
    abilityId: null,
    moveUsageCounts: {},
  };
}

describe("move-usage", () => {
  it("normalizes invalid move usage maps", () => {
    expect(normalizeMoveUsageCounts({ "rage-fist": -2, "": 10, tackle: 3.8 })).toEqual({
      "rage-fist": 0,
      tackle: 3.8,
    });
  });

  it("records move usage on the pokemon", () => {
    const pokemon = createPokemon();

    expect(recordMoveUsage(pokemon, "rage-fist")).toBe(1);
    expect(recordMoveUsage(pokemon, "rage-fist", 2)).toBe(3);
    expect(getMoveUsageCount(pokemon.moveUsageCounts, "rage-fist")).toBe(3);
  });
});
