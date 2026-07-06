import { describe, expect, it } from "vitest";
import type { UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { syncEligibleEvolutions } from "../../src/game/pending-evolution.js";
import { getMatchingEvolutionBranches } from "../../src/game/growth.js";

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

describe("syncEligibleEvolutions", () => {
  it("queues a pending evolution for a stuck level-100 charmander in the party", () => {
    const user = createUserData();
    const charmander = createPokemon("charmander", 100);
    user.party = [charmander.uid];
    user.pokemon = [charmander];

    const queued = syncEligibleEvolutions(user, {});

    expect(queued).toBe(1);
    expect(user.pendingEvolutions).toHaveLength(1);
    const pending = user.pendingEvolutions![0];
    expect(pending.pokemonUid).toBe(charmander.uid);
    expect(pending.sourceSpecies).toBe("charmander");
    expect(pending.options.map((o) => o.targetSpecies)).toContain("charmeleon");
    // It only queues — never auto-transforms.
    expect(charmander.species).toBe("charmander");
  });

  it("does not re-queue a pokemon that already has a pending evolution", () => {
    const user = createUserData();
    const charmander = createPokemon("charmander", 100);
    user.party = [charmander.uid];
    user.pokemon = [charmander];
    user.pendingEvolutions = [
      {
        id: "existing",
        pokemonUid: charmander.uid,
        sourceSpecies: "charmander",
        sourceName: "Charmander",
        trigger: "level-up",
        options: [
          { branchId: "charmander-charmeleon-1", targetSpecies: "charmeleon", targetName: "Charmeleon" },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const queued = syncEligibleEvolutions(user, {});

    expect(queued).toBe(0);
    expect(user.pendingEvolutions).toHaveLength(1);
    expect(user.pendingEvolutions![0].id).toBe("existing");
  });

  it("queues for an eligible charmander sitting in storage (not party)", () => {
    const user = createUserData();
    const charmander = createPokemon("charmander", 100);
    user.storage = [charmander];

    const queued = syncEligibleEvolutions(user, {});

    expect(queued).toBe(1);
    expect(user.pendingEvolutions).toHaveLength(1);
    expect(user.pendingEvolutions![0].pokemonUid).toBe(charmander.uid);
  });

  it("queues nothing for a species with no level-up branch met (fully evolved)", () => {
    const user = createUserData();
    const charizard = createPokemon("charizard", 100);
    user.party = [charizard.uid];
    user.pokemon = [charizard];

    const queued = syncEligibleEvolutions(user, {});

    expect(queued).toBe(0);
    expect(user.pendingEvolutions).toHaveLength(0);
  });

  it("queues nothing when the level branch is not yet met", () => {
    const user = createUserData();
    // charmander evolves at level 16 — a level-5 mon is not yet eligible.
    const charmander = createPokemon("charmander", 5);
    user.party = [charmander.uid];
    user.pokemon = [charmander];

    const queued = syncEligibleEvolutions(user, {});

    expect(queued).toBe(0);
    expect(user.pendingEvolutions).toHaveLength(0);
  });

  it("is idempotent — running twice queues things only once", () => {
    const user = createUserData();
    const charmander = createPokemon("charmander", 100);
    user.party = [charmander.uid];
    user.pokemon = [charmander];

    const first = syncEligibleEvolutions(user, {});
    const second = syncEligibleEvolutions(user, {});

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(user.pendingEvolutions).toHaveLength(1);
  });

  it("does not queue a pending evolution whose only matching branch targets a non-existent species", () => {
    // applin의 applin-dipplin-1 분기(trigger:"other", conditions:[])는 어떤 레벨에서도
    // branchMatches를 통과하지만, 대상 종 dipplin이 species.json에 없어 큐잉되면 안 된다.
    const user = createUserData();
    const applin = createPokemon("applin", 20);
    user.party = [applin.uid];
    user.pokemon = [applin];

    const queued = syncEligibleEvolutions(user, {});

    expect(queued).toBe(0);
    expect(user.pendingEvolutions).toHaveLength(0);
  });
});

describe("getMatchingEvolutionBranches non-existent target filtering", () => {
  it("excludes branches whose target species does not exist (applin -> dipplin)", () => {
    const branches = getMatchingEvolutionBranches("applin", { level: 20 });
    expect(branches.map((branch) => branch.targetSpecies)).not.toContain("dipplin");
  });

  it("still returns valid level-up branches for a normal species (charmander -> charmeleon)", () => {
    const branches = getMatchingEvolutionBranches("charmander", { level: 100 });
    expect(branches.map((branch) => branch.targetSpecies)).toContain("charmeleon");
  });
});
