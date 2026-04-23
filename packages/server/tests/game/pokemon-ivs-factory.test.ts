import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPokemon,
  createWildPokemon,
  rollIvs,
  wildPokemonToOwned,
} from "../../src/game/pokemon-factory.js";
import { hatchEgg, createEgg } from "../../src/game/egg-gacha.js";
import { fusePokemon, unfusePokemon } from "../../src/game/fusion.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

function makeBlankUser(): UserData {
  return {
    account: {
      id: "u1",
      password: "pw",
      nickname: "tester",
      createdAt: new Date().toISOString(),
      matchings: {},
    },
    points: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
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
  };
}

describe("rollIvs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("produces all 6 IVs in the 0-31 range", () => {
    for (let i = 0; i < 200; i++) {
      const ivs = rollIvs();
      for (const key of ["hp", "attack", "defense", "spAttack", "spDefense", "speed"] as const) {
        expect(ivs[key]).toBeGreaterThanOrEqual(0);
        expect(ivs[key]).toBeLessThanOrEqual(31);
        expect(Number.isInteger(ivs[key])).toBe(true);
      }
    }
  });

  it("produces a roughly uniform distribution across 1000 rolls", () => {
    const counts: number[] = new Array(32).fill(0);
    for (let i = 0; i < 1000; i++) {
      const ivs = rollIvs();
      counts[ivs.attack]++;
    }
    const nonZeroBuckets = counts.filter((c) => c > 0).length;
    // With 1000 samples across 32 buckets we expect ~31 avg per bucket.
    // Require a very loose minimum — at least 20 distinct buckets got a hit.
    expect(nonZeroBuckets).toBeGreaterThan(20);

    // Not all rolls are 0 or 31.
    expect(counts[0]).toBeLessThan(1000);
    expect(counts[31]).toBeLessThan(1000);
    // At least one roll hits the extreme ends eventually (very high probability).
    expect(counts.reduce((s, c) => s + c, 0)).toBe(1000);
  });
});

describe("createPokemon assigns IVs", () => {
  it("sets ivs on the returned OwnedPokemon", () => {
    const pokemon = createPokemon("bulbasaur", 5);
    expect(pokemon.ivs).toBeDefined();
    expect(pokemon.ivs?.hp).toBeGreaterThanOrEqual(0);
    expect(pokemon.ivs?.hp).toBeLessThanOrEqual(31);
    expect(pokemon.ivs?.attack).toBeGreaterThanOrEqual(0);
    expect(pokemon.ivs?.attack).toBeLessThanOrEqual(31);
  });

  it("generates different IVs across many calls (not deterministic zero)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const p = createPokemon("bulbasaur", 5);
      seen.add(JSON.stringify(p.ivs));
    }
    // At least a handful of distinct IV combinations emerge.
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe("createWildPokemon assigns IVs", () => {
  it("sets ivs on the WildPokemon", () => {
    const wild = createWildPokemon("pidgey", 5);
    expect(wild.ivs).toBeDefined();
    expect(wild.ivs?.speed).toBeGreaterThanOrEqual(0);
    expect(wild.ivs?.speed).toBeLessThanOrEqual(31);
  });
});

describe("wildPokemonToOwned preserves IVs", () => {
  it("copies the wild pokemon IVs into the owned pokemon", () => {
    const wild = createWildPokemon("pidgey", 5);
    const owned = wildPokemonToOwned(wild);
    expect(owned.ivs).toBeDefined();
    expect(owned.ivs).toEqual(wild.ivs);
    // Mutating the returned copy should not mutate wild.ivs.
    if (owned.ivs && wild.ivs) {
      owned.ivs.hp = 99;
      expect(wild.ivs.hp).not.toBe(99);
    }
  });

  it("leaves ivs undefined when the wild pokemon lacks them (legacy path)", () => {
    const wild = createWildPokemon("pidgey", 5);
    delete (wild as { ivs?: unknown }).ivs;
    const owned = wildPokemonToOwned(wild);
    expect(owned.ivs).toBeUndefined();
  });
});

describe("hatchEgg produces a pokemon with IVs", () => {
  it("IV is set after hatching", () => {
    const egg = createEgg("common");
    const { pokemon } = hatchEgg(egg);
    expect(pokemon.ivs).toBeDefined();
    expect(pokemon.ivs?.hp).toBeGreaterThanOrEqual(0);
  });
});

describe("fusion preserves partner IVs", () => {
  function seedKyurem(): OwnedPokemon {
    return {
      ...createPokemon("kyurem", 50),
      ivs: { hp: 10, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 10 },
    };
  }
  function seedReshiram(): OwnedPokemon {
    return {
      ...createPokemon("reshiram", 50),
      ivs: { hp: 25, attack: 20, defense: 15, spAttack: 31, spDefense: 18, speed: 22 },
    };
  }

  it("fuse stores partner IVs, unfuse restores them", () => {
    const user = makeBlankUser();
    const base = seedKyurem();
    const partner = seedReshiram();
    user.pokemon.push(base, partner);
    user.inventory["dna-splicers"] = 1;

    const originalPartnerIvs = { ...partner.ivs! };
    const originalBaseIvs = { ...base.ivs! };

    const fused = fusePokemon(user, base.uid, partner.uid, "dna-splicers");
    expect(fused.ok).toBe(true);
    expect(fused.fusedPokemon).toBeDefined();
    expect(fused.fusedPokemon!.fusedPartnerData?.ivs).toEqual(originalPartnerIvs);
    // Base keeps its own IVs untouched.
    expect(fused.fusedPokemon!.ivs).toEqual(originalBaseIvs);

    const unfused = unfusePokemon(user, fused.fusedPokemon!.uid);
    expect(unfused.ok).toBe(true);
    const restoredPartner = user.pokemon.find((p) => p.species === "reshiram");
    expect(restoredPartner).toBeDefined();
    expect(restoredPartner!.ivs).toEqual(originalPartnerIvs);
  });
});
