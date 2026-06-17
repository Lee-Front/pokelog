import { describe, expect, it, beforeEach } from "vitest";
import {
  evolvePokemon,
  getEvolutionBranches,
  getEvolutionBranchDiagnostics,
} from "../../src/game/growth.js";
import {
  clearAllCaches,
  getVariantById,
  getSpeciesByName,
} from "../../src/game/data-loader.js";
import {
  queuePendingEvolution,
  resolvePendingEvolutionChoice,
} from "../../src/game/pending-evolution.js";
import type { EvolutionBranch, OwnedPokemon, UserData } from "../../../../shared/types.js";

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

function createUserData(): UserData {
  return {
    account: {
      id: "test-user",
      password: "pw",
      nickname: "tester",
      createdAt: "2026-01-01T00:00:00.000Z",
      matchings: {},
    },
    points: 0,
    battleMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [],
    pokemon: [],
    eggs: [],
    pokedex: [],
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

describe("rockruff → lycanroc form evolution data", () => {
  beforeEach(() => clearAllCaches());

  it("branch 2 (night) carries the lycanroc-midnight variant", () => {
    const branch = getEvolutionBranches("rockruff").find((b) => b.id === "rockruff-lycanroc-2");
    expect(branch).toBeDefined();
    expect(branch?.targetSpecies).toBe("lycanroc");
    expect(branch?.targetVariantId).toBe("lycanroc-midnight");
  });

  it("branch 3 (dusk, no time) carries the lycanroc-dusk variant", () => {
    const branch = getEvolutionBranches("rockruff").find((b) => b.id === "rockruff-lycanroc-3");
    expect(branch).toBeDefined();
    expect(branch?.targetSpecies).toBe("lycanroc");
    expect(branch?.targetVariantId).toBe("lycanroc-dusk");
  });

  it("branch 1 (day) stays the base Midday form with no variant", () => {
    const branch = getEvolutionBranches("rockruff").find((b) => b.id === "rockruff-lycanroc-1");
    expect(branch).toBeDefined();
    expect(branch?.targetSpecies).toBe("lycanroc");
    expect(branch?.targetVariantId).toBeUndefined();
  });
});

describe("getEvolutionBranchDiagnostics variant labels", () => {
  beforeEach(() => clearAllCaches());

  it("labels variant branches with the form name and forwards targetVariantId", () => {
    const diagnostics = getEvolutionBranchDiagnostics("rockruff", { level: 25 });

    const midnight = diagnostics.find((d) => d.branchId === "rockruff-lycanroc-2");
    expect(midnight?.targetVariantId).toBe("lycanroc-midnight");
    expect(midnight?.targetName).toBe(getVariantById("lycanroc-midnight")?.name);
    expect(midnight?.targetName).toBe("Lycanroc Midnight");

    const dusk = diagnostics.find((d) => d.branchId === "rockruff-lycanroc-3");
    expect(dusk?.targetVariantId).toBe("lycanroc-dusk");
    expect(dusk?.targetName).toBe("Lycanroc Dusk");

    // base (Midday) branch keeps the species name and exposes no variant id
    const midday = diagnostics.find((d) => d.branchId === "rockruff-lycanroc-1");
    expect(midday?.targetVariantId).toBeUndefined();
    expect(midday?.targetName).toBe(getSpeciesByName("lycanroc")?.name);
  });
});

describe("pending evolution variant options", () => {
  beforeEach(() => clearAllCaches());

  it("buildOption (via queue) sets the variant display name for variant branches", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon({ uid: "rockruff-uid", species: "rockruff" });
    user.pokemon = [pokemon];

    const pending = queuePendingEvolution(user, pokemon, getEvolutionBranches("rockruff"));

    const midnightOption = pending.options.find((o) => o.branchId === "rockruff-lycanroc-2");
    expect(midnightOption?.targetVariantId).toBe("lycanroc-midnight");
    expect(midnightOption?.targetName).toBe("Lycanroc Midnight");

    const middayOption = pending.options.find((o) => o.branchId === "rockruff-lycanroc-1");
    expect(middayOption?.targetVariantId).toBeUndefined();
    expect(middayOption?.targetName).toBe(getSpeciesByName("lycanroc")?.name);
  });

  it("resolves a STALE pending (no targetVariantId snapshot) into the current variant form", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon({ uid: "rockruff-uid", species: "rockruff", level: 25 });
    user.pokemon = [pokemon];
    user.pokedex = ["rockruff"];

    // Simulate a pending queued from OLD data: the snapshot option lacks
    // targetVariantId even though the current evolution.json sets it.
    const staleBranches: EvolutionBranch[] = [
      {
        id: "rockruff-lycanroc-2",
        targetSpecies: "lycanroc",
        trigger: "level-up",
        conditions: [],
        consumeItem: null,
      },
    ];
    const pending = queuePendingEvolution(user, pokemon, staleBranches);
    // Confirm the snapshot really is stale (no variant id stored).
    expect(pending.options[0]?.targetVariantId).toBeUndefined();

    const result = resolvePendingEvolutionChoice(user, pending.id, "rockruff-lycanroc-2");

    // Resolved authoritatively from current data → midnight form.
    expect(result.targetSpecies).toBe("lycanroc");
    expect(pokemon.species).toBe("lycanroc");
    expect(pokemon.variantId).toBe("lycanroc-midnight");
    expect(user.pendingEvolutions).toHaveLength(0);
  });

  it("resolves the dusk branch from a stale pending into lycanroc-dusk", () => {
    const user = createUserData();
    const pokemon = createOwnedPokemon({ uid: "rockruff-uid", species: "rockruff", level: 25 });
    user.pokemon = [pokemon];
    user.pokedex = ["rockruff"];

    const staleBranches: EvolutionBranch[] = [
      {
        id: "rockruff-lycanroc-3",
        targetSpecies: "lycanroc",
        trigger: "level-up",
        conditions: [],
        consumeItem: null,
      },
    ];
    const pending = queuePendingEvolution(user, pokemon, staleBranches);

    resolvePendingEvolutionChoice(user, pending.id, "rockruff-lycanroc-3");

    expect(pokemon.species).toBe("lycanroc");
    expect(pokemon.variantId).toBe("lycanroc-dusk");
  });
});

describe("evolved variant stats apply baseStatsOverride", () => {
  beforeEach(() => clearAllCaches());

  it("stores the midnight form's overridden stats on evolve (mirrors wild-variant convention)", () => {
    // Base (Midday) lycanroc: hp 75, speed 112. Midnight override: hp 85, speed 82.
    const midday = createOwnedPokemon({ species: "rockruff", level: 50, nature: undefined });
    evolvePokemon(midday, "lycanroc");

    const midnight = createOwnedPokemon({ species: "rockruff", level: 50, nature: undefined });
    evolvePokemon(midnight, "lycanroc", "lycanroc-midnight");

    // Midnight has higher HP and lower Speed than the base Midday form.
    expect(midnight.maxHp).toBeGreaterThan(midday.maxHp);
    expect(midnight.stats.speed).toBeLessThan(midday.stats.speed);
  });

  it("stores the dusk form's overridden stats on evolve", () => {
    // Base attack 115, Dusk override attack 117.
    const midday = createOwnedPokemon({ species: "rockruff", level: 50, nature: undefined });
    evolvePokemon(midday, "lycanroc");

    const dusk = createOwnedPokemon({ species: "rockruff", level: 50, nature: undefined });
    evolvePokemon(dusk, "lycanroc", "lycanroc-dusk");

    expect(dusk.stats.attack).toBeGreaterThan(midday.stats.attack);
  });
});
