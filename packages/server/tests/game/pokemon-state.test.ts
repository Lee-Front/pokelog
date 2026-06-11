import { describe, it, expect, vi, beforeEach } from "vitest";
import { findPokemonByUid, getPartyPokemon, resolveSpeciesOrVariant, getEffectiveVariantId, getEffectiveTypes, getDisplaySpeciesName } from "../../src/game/pokemon-state.js";
import type { UserData, OwnedPokemon, SpeciesData, VariantData } from "../../../../shared/types.js";
import * as dataLoader from "../../src/game/data-loader.js";

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
    battleMoney: 0,
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

/* ────────── helper stubs ────────── */

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

function stubVariant(overrides: Partial<VariantData> = {}): VariantData {
  return {
    id: "bulbasaur-mega",
    baseSpecies: "bulbasaur",
    kind: "battle-form",
    name: "Mega Bulbasaur",
    category: "mega",
    sourceArtSlug: "bulbasaur-mega",
    formSuffix: "-mega",
    encounterEligible: false,
    eggEligible: false,
    ...overrides,
  };
}

/* ────────── resolveSpeciesOrVariant ────────── */

describe("resolveSpeciesOrVariant", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns speciesData when species is known", () => {
    const species = stubSpecies();
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);

    const result = resolveSpeciesOrVariant("bulbasaur");
    expect(result.baseSpecies).toBe("bulbasaur");
    expect(result.speciesData).toBe(species);
    expect(result.variantId).toBeNull();
    expect(result.variant).toBeNull();
  });

  it("resolves a variant id to base species and variant", () => {
    const species = stubSpecies();
    const variant = stubVariant({ id: "bulbasaur-mega", baseSpecies: "bulbasaur" });

    vi.spyOn(dataLoader, "getSpeciesByName")
      .mockReturnValueOnce(undefined)       // first call: "bulbasaur-mega" not found
      .mockReturnValueOnce(species);         // second call: "bulbasaur" found
    vi.spyOn(dataLoader, "getVariantById").mockReturnValue(variant);

    const result = resolveSpeciesOrVariant("bulbasaur-mega");
    expect(result.baseSpecies).toBe("bulbasaur");
    expect(result.variantId).toBe("bulbasaur-mega");
    expect(result.variant).toBe(variant);
    expect(result.speciesData).toBe(species);
  });

  it("returns nulls for a completely unknown species", () => {
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(undefined);
    vi.spyOn(dataLoader, "getVariantById").mockReturnValue(undefined);

    const result = resolveSpeciesOrVariant("fakemon");
    expect(result.baseSpecies).toBe("fakemon");
    expect(result.speciesData).toBeNull();
    expect(result.variantId).toBeNull();
    expect(result.variant).toBeNull();
  });
});

/* ────────── getEffectiveVariantId ────────── */

describe("getEffectiveVariantId", () => {
  it("returns null when both are null/undefined", () => {
    expect(getEffectiveVariantId(null, null)).toBeNull();
    expect(getEffectiveVariantId(undefined, undefined)).toBeNull();
    expect(getEffectiveVariantId(null, undefined)).toBeNull();
  });

  it("returns variantId when battleForm is absent", () => {
    expect(getEffectiveVariantId("alola", null)).toBe("alola");
    expect(getEffectiveVariantId("alola", undefined)).toBe("alola");
  });

  it("returns battleForm when it is present (takes precedence)", () => {
    expect(getEffectiveVariantId("alola", "mega")).toBe("mega");
    expect(getEffectiveVariantId(null, "mega")).toBe("mega");
  });
});

/* ────────── getEffectiveTypes ────────── */

describe("getEffectiveTypes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns base species types when no variant", () => {
    const species = stubSpecies({ types: ["fire", "flying"] });
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getVariantById").mockReturnValue(undefined);

    expect(getEffectiveTypes("charizard")).toEqual(["fire", "flying"]);
  });

  it("returns variant typing when variant has type override", () => {
    const species = stubSpecies({ types: ["fire", "flying"] });
    const variant = stubVariant({ typing: ["fire", "dragon"] });
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getVariantById").mockReturnValue(variant);

    expect(getEffectiveTypes("charizard", "charizard-mega-x")).toEqual(["fire", "dragon"]);
  });

  it("falls back to base types when variant has no typing override", () => {
    const species = stubSpecies({ types: ["water"] });
    const variant = stubVariant({ typing: undefined });
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(species);
    vi.spyOn(dataLoader, "getVariantById").mockReturnValue(variant);

    expect(getEffectiveTypes("squirtle", "squirtle-gmax")).toEqual(["water"]);
  });

  it("returns empty array for unknown species with no variant", () => {
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(undefined);
    vi.spyOn(dataLoader, "getVariantById").mockReturnValue(undefined);

    expect(getEffectiveTypes("fakemon")).toEqual([]);
  });
});

/* ────────── getDisplaySpeciesName ────────── */

describe("getDisplaySpeciesName", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the species display name when found", () => {
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(stubSpecies({ name: "Bulbasaur" }));
    expect(getDisplaySpeciesName("bulbasaur")).toBe("Bulbasaur");
  });

  it("falls back to the species key when not found", () => {
    vi.spyOn(dataLoader, "getSpeciesByName").mockReturnValue(undefined);
    expect(getDisplaySpeciesName("fakemon")).toBe("fakemon");
  });
});
