import { describe, expect, it } from "vitest";
import type { EvolutionBranch, UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { queuePendingEvolution, resolvePendingEvolutionChoice } from "../../src/game/pending-evolution.js";

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
});
