import { describe, expect, it } from "vitest";
import type { UserData } from "../../../../shared/types.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import {
  getAvailableEvolutionOptions,
  prunePendingEvolutions,
} from "../../src/game/pending-evolution.js";
import { getMatchingEvolutionBranches } from "../../src/game/growth.js";

// 과거 이 파일은 syncEligibleEvolutions(레벨업 자동 큐잉의 소급판)를 검증했다. 자동 진화/큐잉을
// 제거하고 진화를 온디맨드로 옮긴 뒤로는, "적격 진화가 큐잉되지 않고 getAvailableEvolutionOptions로
// 그때그때 노출된다"는 새 계약을 검증한다(파일명은 실행 필터 호환을 위해 유지).

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

describe("getAvailableEvolutionOptions — surfaces eligible evolutions WITHOUT queuing", () => {
  it("surfaces the charmeleon branch for a stuck level-100 charmander in the party", () => {
    const user = createUserData();
    const charmander = createPokemon("charmander", 100);
    user.party = [charmander.uid];
    user.pokemon = [charmander];

    const options = getAvailableEvolutionOptions(user, charmander, {});

    expect(options.map((o) => o.targetSpecies)).toContain("charmeleon");
    // 큐잉하지 않는다 — 응답 시 계산만.
    expect(user.pendingEvolutions ?? []).toHaveLength(0);
    // 자동 변신도 없다.
    expect(charmander.species).toBe("charmander");
  });

  it("surfaces options for an over-leveled charmander sitting in storage (not party)", () => {
    const user = createUserData();
    const charmander = createPokemon("charmander", 100);
    user.storage = [charmander];

    const options = getAvailableEvolutionOptions(user, charmander, {});

    expect(options.map((o) => o.targetSpecies)).toContain("charmeleon");
    expect(user.pendingEvolutions ?? []).toHaveLength(0);
  });

  it("returns [] for a fully-evolved species (no level-up branch met)", () => {
    const user = createUserData();
    const charizard = createPokemon("charizard", 100);
    user.party = [charizard.uid];
    user.pokemon = [charizard];

    expect(getAvailableEvolutionOptions(user, charizard, {})).toEqual([]);
  });

  it("returns [] when the level branch is not yet met", () => {
    const user = createUserData();
    // charmander는 레벨 16에 진화 — 레벨 5 개체는 아직 적격 아님.
    const charmander = createPokemon("charmander", 5);
    user.party = [charmander.uid];
    user.pokemon = [charmander];

    expect(getAvailableEvolutionOptions(user, charmander, {})).toEqual([]);
  });

  it("excludes item-only evolutions (pikachu → raichu needs a thunder-stone)", () => {
    const user = createUserData();
    const pikachu = createPokemon("pikachu", 50);
    user.party = [pikachu.uid];
    user.pokemon = [pikachu];

    // 아이템 진화는 usedItem 컨텍스트가 없어 매칭되지 않는다(가방에서 처리).
    expect(getAvailableEvolutionOptions(user, pikachu, {})).toEqual([]);
  });

  it("excludes branches whose target species does not exist (applin → dipplin)", () => {
    const user = createUserData();
    const applin = createPokemon("applin", 20);
    user.party = [applin.uid];
    user.pokemon = [applin];

    expect(getAvailableEvolutionOptions(user, applin, {})).toEqual([]);
    expect(user.pendingEvolutions ?? []).toHaveLength(0);
  });
});

describe("prunePendingEvolutions — legacy cleanup still applies", () => {
  it("removes pending whose options all target non-existent species, keeping valid ones", () => {
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
