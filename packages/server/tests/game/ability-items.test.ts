import { describe, expect, it } from "vitest";
import type { UserData } from "../../../../shared/types.js";
import { createPokemon, pickAbilityId } from "../../src/game/pokemon-factory.js";
import { getSpeciesByName } from "../../src/game/data-loader.js";
import { ItemUseError, useInventoryItem } from "../../src/game/item-usage.js";

// item-usage.test.ts 와 동일 스타일의 최소 UserData 팩토리.
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
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
    pendingEvolutions: [],
    currentRegion: "default",
  };
}

// 테스트 대상 종의 특성 구성(species.json 확인 결과):
//  - pidgey  : normal = [keen-eye, tangled-feet], hidden = big-pecks (일반 2개 + 숨은)
//  - bulbasaur: normal = [overgrow], hidden = chlorophyll (일반 1개 → 캡슐 거부용)
//  - gastly  : normal = [levitate], hidden 없음 (패치 거부용)

describe("ability-capsule (특성캡슐)", () => {
  it("swaps between the two regular abilities and consumes the item", () => {
    const user = createUserData();
    const pokemon = createPokemon("pidgey", 10);
    pokemon.abilityId = "keen-eye"; // normal[0] 로 고정 후 시작

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "ability-capsule": 2 };

    const first = useInventoryItem(user, "ability-capsule", pokemon.uid);
    expect(first.kind).toBe("ability");
    expect(first.abilityId).toBe("tangled-feet"); // normal[0] → normal[1]
    expect(pokemon.abilityId).toBe("tangled-feet");
    expect(user.inventory["ability-capsule"]).toBe(1);

    const second = useInventoryItem(user, "ability-capsule", pokemon.uid);
    expect(second.abilityId).toBe("keen-eye"); // 다시 normal[0] 로
    expect(pokemon.abilityId).toBe("keen-eye");
    expect(user.inventory["ability-capsule"]).toBeUndefined();
  });

  it("sets normal[0] when the current ability is not a regular ability (e.g. hidden/none)", () => {
    const user = createUserData();
    const pokemon = createPokemon("pidgey", 10);
    pokemon.abilityId = "big-pecks"; // 숨은 특성 → 일반이 아님

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "ability-capsule": 1 };

    const result = useInventoryItem(user, "ability-capsule", pokemon.uid);
    expect(result.abilityId).toBe("keen-eye"); // normal[0]
    expect(pokemon.abilityId).toBe("keen-eye");
  });

  it("rejects a species with fewer than two regular abilities and keeps the item", () => {
    const user = createUserData();
    const pokemon = createPokemon("bulbasaur", 10); // 일반 특성 1개

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "ability-capsule": 1 };

    const before = pokemon.abilityId;
    expect(() => useInventoryItem(user, "ability-capsule", pokemon.uid)).toThrow(ItemUseError);
    expect(pokemon.abilityId).toBe(before);
    expect(user.inventory["ability-capsule"]).toBe(1);
  });
});

describe("ability-patch (특성패치)", () => {
  it("sets the hidden ability, then reverts to normal[0], consuming the item each time", () => {
    const user = createUserData();
    const pokemon = createPokemon("pidgey", 10);
    pokemon.abilityId = "keen-eye"; // 일반 특성으로 시작

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "ability-patch": 2 };

    const first = useInventoryItem(user, "ability-patch", pokemon.uid);
    expect(first.kind).toBe("ability");
    expect(first.abilityId).toBe("big-pecks"); // 숨은 특성으로
    expect(pokemon.abilityId).toBe("big-pecks");
    expect(user.inventory["ability-patch"]).toBe(1);

    const second = useInventoryItem(user, "ability-patch", pokemon.uid);
    expect(second.abilityId).toBe("keen-eye"); // 숨은 → normal[0] 로 되돌림
    expect(pokemon.abilityId).toBe("keen-eye");
    expect(user.inventory["ability-patch"]).toBeUndefined();
  });

  it("rejects a species without a hidden ability and keeps the item", () => {
    const user = createUserData();
    const pokemon = createPokemon("gastly", 10); // 숨은 특성 없음

    user.party = [pokemon.uid];
    user.pokemon = [pokemon];
    user.inventory = { "ability-patch": 1 };

    const before = pokemon.abilityId;
    expect(() => useInventoryItem(user, "ability-patch", pokemon.uid)).toThrow(ItemUseError);
    expect(pokemon.abilityId).toBe(before);
    expect(user.inventory["ability-patch"]).toBe(1);
  });
});

describe("pickAbilityId", () => {
  it("returns a member of the species' regular abilities", () => {
    const pidgey = getSpeciesByName("pidgey");
    expect(pidgey?.abilities).toBeDefined();

    for (let i = 0; i < 30; i += 1) {
      const picked = pickAbilityId(pidgey!);
      expect(pidgey!.abilities!.normal).toContain(picked);
    }
  });

  it("returns null when the species has no regular abilities", () => {
    const pidgey = getSpeciesByName("pidgey")!;
    const noAbility = { ...pidgey, abilities: { normal: [] } };
    expect(pickAbilityId(noAbility)).toBeNull();
  });
});
