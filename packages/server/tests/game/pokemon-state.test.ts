import { describe, it, expect } from "vitest";
import { findPokemonByUid, getPartyPokemon } from "../../src/game/pokemon-state.js";
import type { UserData, OwnedPokemon } from "../../../../shared/types.js";

function makePokemon(uid: string, species = "bulbasaur"): OwnedPokemon {
  return {
    uid,
    species,
    nickname: null,
    level: 5,
    exp: 0,
    hp: 20,
    maxHp: 20,
    stats: { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 },
    moves: [],
    caughtAt: "2026-01-01",
  };
}

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    account: { id: "test", username: "tester", createdAt: "2026-01-01" },
    points: 0,
    totalExp: 0,
    combo: { current: 0, maxMultiplier: 1, lastCommitAt: null },
    encounterCeiling: { current: 100, lastResetDate: "2026-01-01" },
    party: [],
    pokemon: [],
    eggs: [],
    pokedex: [],
    inventory: {},
    pendingEvents: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
    ...overrides,
  };
}

describe("findPokemonByUid", () => {
  it("finds a pokemon in the party list", () => {
    const p = makePokemon("abc");
    const user = makeUser({ pokemon: [p], party: ["abc"] });
    expect(findPokemonByUid(user, "abc")).toBe(p);
  });

  it("finds a pokemon in storage", () => {
    const p = makePokemon("stored-1");
    const user = makeUser({ storage: [p] });
    expect(findPokemonByUid(user, "stored-1")).toBe(p);
  });

  it("returns undefined for an unknown uid", () => {
    const user = makeUser({
      pokemon: [makePokemon("a")],
      storage: [makePokemon("b")],
    });
    expect(findPokemonByUid(user, "nonexistent")).toBeUndefined();
  });

  it("prefers party (pokemon array) over storage when uid exists in both", () => {
    const partyPokemon = makePokemon("dup", "pikachu");
    const storagePokemon = makePokemon("dup", "charmander");
    const user = makeUser({
      pokemon: [partyPokemon],
      storage: [storagePokemon],
    });
    expect(findPokemonByUid(user, "dup")).toBe(partyPokemon);
  });
});

describe("getPartyPokemon", () => {
  it("returns pokemon in party order", () => {
    const p1 = makePokemon("first", "bulbasaur");
    const p2 = makePokemon("second", "charmander");
    const p3 = makePokemon("third", "squirtle");
    const user = makeUser({
      pokemon: [p3, p1, p2],
      party: ["first", "second", "third"],
    });
    const result = getPartyPokemon(user);
    expect(result).toEqual([p1, p2, p3]);
  });

  it("skips missing UIDs gracefully", () => {
    const p1 = makePokemon("exists");
    const user = makeUser({
      pokemon: [p1],
      party: ["exists", "gone", "also-gone"],
    });
    const result = getPartyPokemon(user);
    expect(result).toEqual([p1]);
    expect(result).toHaveLength(1);
  });

  it("returns an empty array when party is empty", () => {
    const user = makeUser({ pokemon: [makePokemon("a")], party: [] });
    expect(getPartyPokemon(user)).toEqual([]);
  });
});
