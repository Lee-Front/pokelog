import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// doWildAttackAndCheck는 기절 시 saveUser로 영속화한다. 저장은 파일 IO라 no-op으로 막고
// 순수 전투 로직(특성)만 검증한다.
vi.mock("../../src/storage/user-store.js", () => ({
  saveUser: vi.fn(async () => {}),
}));

import { doWildAttackAndCheck } from "../../src/game/battle-state.js";
import type { BattleState, OwnedPokemon, UserData } from "../../../../shared/types.js";

function makeStats(overrides?: Partial<{ attack: number; defense: number; speed: number; spAttack: number; spDefense: number }>) {
  return { attack: 50, defense: 50, speed: 50, spAttack: 50, spDefense: 50, ...overrides };
}

function makePlayer(overrides?: Partial<OwnedPokemon>): OwnedPokemon {
  return {
    uid: "p1",
    species: "bulbasaur",
    nickname: null,
    level: 20,
    exp: 0,
    hp: 100,
    maxHp: 100,
    stats: makeStats(),
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    caughtAt: "2026-01-01",
    statusCondition: null,
    ...overrides,
  };
}

function makeBattle(): BattleState {
  return {
    eventId: "evt-1",
    myPokemonUid: "p1",
    turn: 1,
    wild: {
      species: "rattata",
      level: 30,
      hp: 200,
      maxHp: 200,
      stats: makeStats({ attack: 200, speed: 40 }),
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    },
    playerStatStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    wildStatStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    playerVolatile: [],
    wildVolatile: [],
  };
}

function makeUser(pokemon: OwnedPokemon): UserData {
  return {
    // 최소 필드만 — doWildAttackAndCheck는 party/pokemon만 참조한다.
    party: [pokemon.uid],
    pokemon: [pokemon],
  } as unknown as UserData;
}

describe("doWildAttackAndCheck — disguise on the player's defending pokemon", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { randomSpy = vi.spyOn(Math, "random"); });
  afterEach(() => { randomSpy.mockRestore(); });

  it("player's disguise absorbs the first wild hit and chips maxHp/8", async () => {
    randomSpy.mockReturnValue(0.5); // accuracy hit, no crit, mid random factor
    const player = makePlayer({ abilityId: "disguise", hp: 80, maxHp: 80 });
    const battle = makeBattle();
    const user = makeUser(player);

    await doWildAttackAndCheck(user, player, battle, [], { id: "tackle", pp: 35, maxPp: 35 });

    expect(battle.playerDisguiseBusted).toBe(true);
    // 첫 타격 무효 + 탈 파괴 도트 80/8=10만 적용.
    expect(player.hp).toBe(70);
  });

  it("a mold-breaker wild ignores the player's disguise (hit lands normally)", async () => {
    randomSpy.mockReturnValue(0.5);
    const player = makePlayer({ abilityId: "disguise", hp: 200, maxHp: 200 });
    const battle = makeBattle();
    battle.wild.ability = "mold-breaker";
    const user = makeUser(player);

    await doWildAttackAndCheck(user, player, battle, [], { id: "tackle", pp: 35, maxPp: 35 });

    // 틀깨기라 탈이 발동하지 않음 → 실제 데미지가 들어가고 busted 플래그도 세워지지 않는다.
    expect(battle.playerDisguiseBusted).toBeUndefined();
    expect(player.hp).toBeLessThan(200);
  });
});

describe("doWildAttackAndCheck — wonder-guard on the player's defending pokemon", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { randomSpy = vi.spyOn(Math, "random"); });
  afterEach(() => { randomSpy.mockRestore(); });

  it("blocks a neutral (non-super-effective) wild attack", async () => {
    randomSpy.mockReturnValue(0.5);
    // 방어자 bulbasaur(풀/독)에게 노말 기술은 신통찮지도 굉장하지도 않은 1배 → 원더가드가 막는다.
    const player = makePlayer({ abilityId: "wonder-guard", hp: 100, maxHp: 100 });
    const battle = makeBattle();
    const user = makeUser(player);

    await doWildAttackAndCheck(user, player, battle, [], { id: "tackle", pp: 35, maxPp: 35 });

    expect(player.hp).toBe(100);
  });
});
