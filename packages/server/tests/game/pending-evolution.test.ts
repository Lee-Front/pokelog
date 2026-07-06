import { describe, expect, it } from "vitest";
import type { EvolutionBranch, UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import {
  prunePendingEvolutions,
  queuePendingEvolution,
  resolvePendingEvolutionChoice,
} from "../../src/game/pending-evolution.js";
import { GameRuleError } from "../../src/game/game-errors.js";

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
    gameMoney: 0,
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

describe("pending-evolution", () => {
  it("queues one pending entry per pokemon and exposes options", () => {
    const user = createUserData();
    const pokemon = createPokemon("eevee", 20);
    user.party = [pokemon.uid];
    user.pokemon = [pokemon];

    const branches: EvolutionBranch[] = [
      {
        id: "eevee-vaporeon",
        targetSpecies: "vaporeon",
        trigger: "use-item",
        conditions: [],
        consumeItem: "water-stone",
      },
      {
        id: "eevee-jolteon",
        targetSpecies: "jolteon",
        trigger: "use-item",
        conditions: [],
        consumeItem: "thunder-stone",
      },
    ];

    const pending = queuePendingEvolution(user, pokemon, branches);

    expect(user.pendingEvolutions).toHaveLength(1);
    expect(pending.options.map((option) => option.branchId)).toEqual([
      "eevee-vaporeon",
      "eevee-jolteon",
    ]);
  });

  it("resolves a chosen branch and removes the pending entry", () => {
    const user = createUserData();
    const pokemon = createPokemon("eevee", 20);
    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.pokedex = ["eevee"];

    const pending = queuePendingEvolution(user, pokemon, [
      {
        id: "eevee-vaporeon",
        targetSpecies: "vaporeon",
        trigger: "use-item",
        conditions: [],
        consumeItem: "water-stone",
      },
      {
        id: "eevee-jolteon",
        targetSpecies: "jolteon",
        trigger: "use-item",
        conditions: [],
        consumeItem: "thunder-stone",
      },
    ]);

    const result = resolvePendingEvolutionChoice(user, pending.id, "eevee-jolteon");

    expect(result.targetSpecies).toBe("jolteon");
    expect(pokemon.species).toBe("jolteon");
    expect(user.pokedex).toContain("jolteon");
    expect(user.pendingEvolutions).toHaveLength(0);
  });

  it("throws a GameRuleError (not a raw 500) when resolving an option that targets a non-existent species", () => {
    const user = createUserData();
    const applin = createPokemon("applin", 20);
    user.party = [applin.uid];
    user.pokemon = [applin];
    user.pokedex = ["applin"];

    // 대상 종(nonexistent-mon)이 species.json에 없는 pending을 인위적으로 만든다 —
    // resolve 시 evolvePokemon이 raw 500이 아니라 GameRuleError(4xx)를 던져야 한다.
    const pending = queuePendingEvolution(user, applin, [
      { id: "applin-nonexistent-1", targetSpecies: "nonexistent-mon", trigger: "other", conditions: [] },
    ]);

    let caught: unknown;
    try {
      resolvePendingEvolutionChoice(user, pending.id, "applin-nonexistent-1");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GameRuleError);
    // 4xx여야 한다 — 라우트가 500이 아닌 깔끔한 4xx로 응답한다.
    expect((caught as GameRuleError).status).toBeLessThan(500);
    expect((caught as GameRuleError).status).toBeGreaterThanOrEqual(400);
  });
});

describe("prunePendingEvolutions", () => {
  it("removes pending evolutions whose options all target non-existent species, keeping valid ones", () => {
    const user = createUserData();
    user.pendingEvolutions = [
      {
        id: "broken-applin",
        pokemonUid: "uid-applin",
        sourceSpecies: "applin",
        sourceName: "Applin",
        trigger: "other",
        options: [
          { branchId: "applin-nonexistent-1", targetSpecies: "nonexistent-mon", targetName: "nonexistent-mon" },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "valid-charmander",
        pokemonUid: "uid-charmander",
        sourceSpecies: "charmander",
        sourceName: "Charmander",
        trigger: "level-up",
        options: [
          { branchId: "charmander-charmeleon-1", targetSpecies: "charmeleon", targetName: "Charmeleon" },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const removed = prunePendingEvolutions(user);

    expect(removed).toBe(1);
    expect(user.pendingEvolutions).toHaveLength(1);
    expect(user.pendingEvolutions![0].id).toBe("valid-charmander");
  });

  it("keeps a pending evolution when at least one option targets an existing species", () => {
    const user = createUserData();
    user.pendingEvolutions = [
      {
        id: "mixed",
        pokemonUid: "uid-mixed",
        sourceSpecies: "applin",
        sourceName: "Applin",
        trigger: "other",
        options: [
          { branchId: "applin-nonexistent-1", targetSpecies: "nonexistent-mon", targetName: "nonexistent-mon" },
          { branchId: "applin-appletun-1", targetSpecies: "appletun", targetName: "Appletun" },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const removed = prunePendingEvolutions(user);

    expect(removed).toBe(0);
    expect(user.pendingEvolutions).toHaveLength(1);
  });

  it("returns 0 and does nothing when there are no broken pending evolutions", () => {
    const user = createUserData();
    const removed = prunePendingEvolutions(user);
    expect(removed).toBe(0);
    expect(user.pendingEvolutions).toHaveLength(0);
  });
});
