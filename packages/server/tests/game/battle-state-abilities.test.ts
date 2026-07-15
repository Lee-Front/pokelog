import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// doWildAttackAndCheck는 기절 시 saveUser로 영속화한다. 저장은 파일 IO라 no-op으로 막고
// 순수 전투 로직(특성)만 검증한다.
vi.mock("../../src/storage/user-store.js", () => ({
  saveUser: vi.fn(async () => {}),
}));

import { doWildAttackAndCheck, executePlayerAttack, revertBattleForms } from "../../src/game/battle-state.js";
import type { BattleState, MoveData, OwnedPokemon, UserData } from "../../../../shared/types.js";

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

// 회귀: 야생/보스의 수면이 매 턴 감소·기상되는지. 과거 야생 경로는 checkPreAttack만 직접 불러
// sleepTurns를 줄이지 않아, 잠든 야생/보스가 영원히 깨지 않았다(주간보스에서 특히 체감).
describe("doWildAttackAndCheck — wild sleep wakes (regression)", () => {
  it("keeps the wild asleep and decrements sleepTurns when > 1 (no attack)", async () => {
    const player = makePlayer({ hp: 100, maxHp: 100 });
    const battle = makeBattle();
    battle.wild.statusCondition = "sleep";
    battle.wild.sleepTurns = 2;
    const user = makeUser(player);

    await doWildAttackAndCheck(user, player, battle, [], { id: "tackle", pp: 35, maxPp: 35 });

    expect(battle.wild.statusCondition).toBe("sleep");
    expect(battle.wild.sleepTurns).toBe(1); // 감소
    expect(player.hp).toBe(100); // 잠들어 공격 못 함
  });

  it("wakes the wild when sleepTurns reaches 0", async () => {
    const player = makePlayer({ hp: 100, maxHp: 100 });
    const battle = makeBattle();
    battle.wild.statusCondition = "sleep";
    battle.wild.sleepTurns = 1;
    const user = makeUser(player);
    const log: string[] = [];

    await doWildAttackAndCheck(user, player, battle, log, { id: "tackle", pp: 35, maxPp: 35 });

    expect(battle.wild.statusCondition).toBeNull();
    expect(battle.wild.sleepTurns).toBeUndefined();
    expect(log.some((l) => l.includes("잠에서 깨어났다"))).toBe(true);
  });
});

// 변신(Transform) — 상대의 종/스탯/기술을 복사하고 전투 종료 시 원복.
describe("Transform (변신)", () => {
  const transformMove = { id: "transform", name: "변신", type: "normal", category: "status", power: 0, accuracy: null, pp: 10 } as unknown as MoveData;

  it("플레이어 변신: 야생의 종/스탯/기술을 복사하고 revert 시 원복한다", () => {
    const player = makePlayer({ species: "ditto", stats: makeStats({ attack: 10 }), moves: [{ id: "transform", pp: 10, maxPp: 10 }] });
    const battle = makeBattle(); // wild=rattata, attack 200, moves=[tackle]
    const log: string[] = [];

    executePlayerAttack(battle, player, transformMove, player.moves[0], log);

    expect(battle.playerPreTransform).toBeTruthy();
    expect(player.species).toBe("rattata");
    expect(player.stats.attack).toBe(200);            // 야생 스탯 복사
    expect(player.moves.map((m) => m.id)).toEqual(["tackle"]);
    expect(player.moves[0].maxPp).toBe(5);            // 복사 기술 PP=5
    expect(log.some((l) => l.includes("변신했다"))).toBe(true);

    revertBattleForms(battle, player);
    expect(player.species).toBe("ditto");             // 원복
    expect(player.stats.attack).toBe(10);
    expect(player.moves.map((m) => m.id)).toEqual(["transform"]);
    expect(battle.playerPreTransform).toBeNull();
  });

  it("이미 변신했으면 다시 변신하지 않는다", () => {
    const player = makePlayer({ species: "ditto", moves: [{ id: "transform", pp: 10, maxPp: 10 }] });
    const battle = makeBattle();
    const log: string[] = [];
    executePlayerAttack(battle, player, transformMove, player.moves[0], log);
    const afterFirst = player.species;
    executePlayerAttack(battle, player, transformMove, { id: "transform", pp: 5, maxPp: 5 }, log);
    expect(player.species).toBe(afterFirst);
    expect(log.some((l) => l.includes("이미 변신"))).toBe(true);
  });
});

// on-KO 특성(자신감/moxie 등) — 야생을 쓰러뜨리면 공격자 스탯 상승.
describe("on-KO 공격 특성", () => {
  const tackle = { id: "tackle", name: "몸통박치기", type: "normal", category: "physical", power: 40, accuracy: 100, pp: 35 } as unknown as MoveData;
  let randomSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); });
  afterEach(() => { randomSpy.mockRestore(); });

  it("moxie로 야생을 쓰러뜨리면 공격 랭크가 +1 된다", () => {
    const player = makePlayer({ abilityId: "moxie", stats: makeStats({ attack: 120 }) });
    const battle = makeBattle();
    battle.wild.hp = 1; // 한 방에 쓰러지게
    const log: string[] = [];

    executePlayerAttack(battle, player, tackle, player.moves[0], log);

    expect(battle.wild.hp).toBe(0);
    expect(battle.playerStatStages.attack).toBe(1);
    expect(log.some((l) => l.includes("능력이 올랐다"))).toBe(true);
  });

  it("특성이 없으면 격파해도 스탯이 그대로다", () => {
    const player = makePlayer({ stats: makeStats({ attack: 120 }) });
    const battle = makeBattle();
    battle.wild.hp = 1;
    executePlayerAttack(battle, player, tackle, player.moves[0], []);
    expect(battle.wild.hp).toBe(0);
    expect(battle.playerStatStages.attack).toBe(0);
  });
});

// 변환 특성(protean/libero) — 사용 기술이 항상 STAB이 되어 데미지가 커진다.
describe("변환 특성(protean)", () => {
  const tackle = { id: "tackle", name: "몸통박치기", type: "normal", category: "physical", power: 40, accuracy: 100, pp: 35 } as unknown as MoveData;
  let randomSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); });
  afterEach(() => { randomSpy.mockRestore(); });

  it("protean이 비-STAB 노말 기술을 STAB로 만들어 데미지가 커진다", () => {
    // 기준(무특성 bulbasaur, 노말 기술은 비-STAB)
    const base = makePlayer({ species: "bulbasaur", stats: makeStats({ attack: 100 }) });
    const b1 = makeBattle(); b1.wild.hp = 99999; b1.wild.maxHp = 99999;
    executePlayerAttack(b1, base, tackle, { id: "tackle", pp: 35, maxPp: 35 }, []);
    const dmgNoProtean = 99999 - b1.wild.hp;

    // protean bulbasaur → 노말 타입이 되어 STAB
    const prot = makePlayer({ species: "bulbasaur", abilityId: "protean", stats: makeStats({ attack: 100 }) });
    const b2 = makeBattle(); b2.wild.hp = 99999; b2.wild.maxHp = 99999;
    const log: string[] = [];
    executePlayerAttack(b2, prot, tackle, { id: "tackle", pp: 35, maxPp: 35 }, log);
    const dmgProtean = 99999 - b2.wild.hp;

    expect(dmgProtean).toBeGreaterThan(dmgNoProtean);
    expect(log.some((l) => l.includes("타입이 되었다"))).toBe(true);
  });
});

// 피격 시 방어자 특성 — 야생의 물리 공격을 맞은 플레이어(stamina)가 방어 상승.
describe("피격 시 방어자 특성(stamina)", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); });
  afterEach(() => { randomSpy.mockRestore(); });

  it("stamina로 야생의 물리 공격을 맞으면 방어 랭크가 +1 된다", async () => {
    const player = makePlayer({ abilityId: "stamina", hp: 500, maxHp: 500 });
    const battle = makeBattle();
    const user = makeUser(player);

    await doWildAttackAndCheck(user, player, battle, [], { id: "tackle", pp: 35, maxPp: 35 });

    expect(player.hp).toBeLessThan(500); // 데미지는 받았고
    expect(player.hp).toBeGreaterThan(0); // 생존
    expect(battle.playerStatStages.defense).toBe(1);
  });
});
