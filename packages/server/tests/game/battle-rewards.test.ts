import { describe, it, expect, beforeEach } from "vitest";
import { clearAllCaches, getSpeciesByName } from "../../src/game/data-loader.js";
import {
  calculateBattleExp,
  calculateBattleMoney,
  rollItemDrop,
  grantBattleRewards,
} from "../../src/game/battle-rewards.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import type { BattleRewardConfig, OwnedPokemon, UserData } from "../../../../shared/types.js";

const config: BattleRewardConfig = {
  expMultiplier: 1.0,
  expShareRatio: 0.5,
  moneyPerLevel: 2,
  moneyBase: 3,
  wildLevelScaling: true,
  wildLevelVariance: 3,
  dropTable: [
    { item: "potion", chance: 0.08, min: 1, max: 1 },
    { item: "super-potion", chance: 0.03, min: 1, max: 1 },
    { item: "poke-ball", chance: 0.05, min: 1, max: 2 },
  ],
};

function makePartyUser(members: OwnedPokemon[]): UserData {
  return {
    account: { id: "u", password: "x", nickname: "U", createdAt: new Date().toISOString(), matchings: {} },
    currentRegion: "default",
    points: 0,
    gameMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: members.map((m) => m.uid),
    pokemon: [...members],
    eggs: [],
    pokedex: members.map((m) => m.species),
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

function makeUser(active: OwnedPokemon): UserData {
  return makePartyUser([active]);
}

beforeEach(() => clearAllCaches());

// 본가 5세대 스케일링 공식을 그대로 재현하는 기대값 헬퍼.
function expectedExpFor(baseExp: number, faintedLevel: number, winnerLevel: number, mult: number) {
  const scale = Math.pow((2 * faintedLevel + 10) / (faintedLevel + winnerLevel + 10), 2.5);
  return Math.floor(((baseExp * faintedLevel) / 5) * scale * mult) + 1;
}

describe("calculateBattleExp", () => {
  it("uses the gen-5 scaled formula floor(baseExp*L/5 * scale) + 1", () => {
    const b = getSpeciesByName("charizard")!.baseExpYield!;
    // 동레벨(30 vs 30) → 스케일 항 = 1
    expect(calculateBattleExp({ species: "charizard", level: 30 }, 30, config)).toBe(
      expectedExpFor(b, 30, 30, config.expMultiplier),
    );
  });

  it("scales by winner level: under-leveled > equal > over-leveled", () => {
    const wild = { species: "charizard", level: 40 } as const;
    const under = calculateBattleExp(wild, 5, config); // 내 레벨이 낮음 → 보너스
    const equal = calculateBattleExp(wild, 40, config); // 동레벨 → 기준
    const over = calculateBattleExp(wild, 60, config); // 내 레벨이 높음 → 페널티
    expect(under).toBeGreaterThan(equal);
    expect(equal).toBeGreaterThan(over);
  });

  it("scales by expMultiplier", () => {
    const b = getSpeciesByName("pidgey")!.baseExpYield!;
    const doubled = { ...config, expMultiplier: 2 };
    expect(calculateBattleExp({ species: "pidgey", level: 10 }, 10, doubled)).toBe(
      expectedExpFor(b, 10, 10, 2),
    );
  });

  it("returns 0 for an unknown species (no base exp)", () => {
    expect(calculateBattleExp({ species: "not-a-pokemon", level: 50 }, 50, config)).toBe(0);
  });
});

describe("calculateBattleMoney", () => {
  it("is floor(level * perLevel) + base", () => {
    expect(calculateBattleMoney(10, config)).toBe(10 * 2 + 3);
    expect(calculateBattleMoney(1, config)).toBe(1 * 2 + 3);
  });
});

describe("rollItemDrop", () => {
  it("returns the first table entry when the roll lands in its band", () => {
    const drop = rollItemDrop(config, () => 0); // 0 < 0.08 → potion
    expect(drop?.item).toBe("potion");
  });

  it("returns null when the roll exceeds the total drop chance", () => {
    expect(rollItemDrop(config, () => 0.99)).toBeNull();
  });

  it("selects the correct entry across cumulative bands", () => {
    // 0.10 → past potion(0.08), within super-potion(0.08..0.11)
    expect(rollItemDrop(config, () => 0.10)?.item).toBe("super-potion");
  });

  it("rolls quantity within [min,max]", () => {
    // land on poke-ball band (0.11..0.16) then max out quantity roll
    let calls = 0;
    const random = () => (calls++ === 0 ? 0.13 : 0.999);
    const drop = rollItemDrop(config, random);
    expect(drop?.item).toBe("poke-ball");
    expect(drop?.qty).toBe(2);
  });
});

describe("grantBattleRewards", () => {
  it("grants exp to the winner, battle money to the user, and the rolled drop", () => {
    const winner = createPokemon("charizard", 30);
    const startExp = winner.exp;
    const user = makeUser(winner);

    const rewards = grantBattleRewards(
      user,
      [winner],
      { species: "pidgey", level: 10 },
      config,
      { random: () => 0, now: new Date("2026-01-01T12:00:00Z") }, // roll 0 → potion drop
    );

    const expectedExp = calculateBattleExp({ species: "pidgey", level: 10 }, 30, config); // winner Lv30
    expect(rewards.exp).toBe(expectedExp);
    expect(winner.exp).toBe(startExp + expectedExp);
    expect(rewards.gameMoney).toBe(calculateBattleMoney(10, config));
    expect(user.gameMoney).toBe(rewards.gameMoney);
    expect(rewards.droppedItems).toEqual([{ item: "potion", qty: 1 }]);
    expect(user.inventory.potion).toBe(1);
  });

  it("reports a level-up when enough exp is granted", () => {
    const winner = createPokemon("caterpie", 3);
    const user = makeUser(winner);
    const bigExpConfig = { ...config, expMultiplier: 1000 };

    const rewards = grantBattleRewards(
      user,
      [winner],
      { species: "charizard", level: 50 },
      bigExpConfig,
      { random: () => 0.99, now: new Date("2026-01-01T12:00:00Z") }, // no drop
    );

    expect(rewards.exp).toBeGreaterThan(0);
    expect(rewards.leveledUp).toBe(true);
    expect(rewards.newLevel).toBeGreaterThan(3);
    expect(winner.level).toBe(rewards.newLevel);
    expect(rewards.droppedItems).toEqual([]);
  });

  it("includeSpoils:false grants exp but no money/drops (capture path)", () => {
    const winner = createPokemon("charizard", 40); // 레벨업이 안 나게 충분히 높은 레벨
    const startExp = winner.exp;
    const user = makeUser(winner);
    user.gameMoney = 100;

    const rewards = grantBattleRewards(
      user,
      [winner],
      { species: "pidgey", level: 10 },
      config,
      // random:0 이면 원래 드랍이 나오는 롤 — includeSpoils:false면 그래도 드랍이 없어야 한다.
      { random: () => 0, now: new Date("2026-01-01T12:00:00Z"), includeSpoils: false },
    );

    const expectedExp = calculateBattleExp({ species: "pidgey", level: 10 }, 40, config); // winner Lv40
    expect(rewards.exp).toBe(expectedExp); // 경험치는 격파(KO)와 동일
    expect(winner.exp).toBe(startExp + expectedExp);
    expect(rewards.gameMoney).toBe(0); // 상금 없음
    expect(user.gameMoney).toBe(100); // 유저 게임머니 불변
    expect(rewards.droppedItems).toEqual([]); // 드랍 없음
    expect(user.inventory.potion).toBeUndefined();
  });
});

describe("grantBattleRewards participant EXP (classic, gen-6+)", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const wild = { species: "pidgey", level: 10 } as const;
  // 풀 EXP가 레벨업/진화를 일으키지 않도록 충분히 높은 레벨의 개체를 사용.
  const opts = { random: () => 0.99, now }; // no drop

  it("gives every living participant the FULL exp (no division)", () => {
    const p1 = createPokemon("charizard", 40);
    const p2 = createPokemon("blastoise", 40);
    const start1 = p1.exp;
    const start2 = p2.exp;
    const user = makePartyUser([p1, p2]);

    const rewards = grantBattleRewards(user, [p1, p2], wild, config, opts);

    const fullExp = calculateBattleExp(wild, 40, config);
    expect(rewards.exp).toBe(fullExp);
    expect(p1.exp).toBe(start1 + fullExp);
    expect(p2.exp).toBe(start2 + fullExp); // 분배 없이 둘 다 풀

    expect(rewards.partyExp).toHaveLength(2);
    expect(rewards.partyExp?.[0]).toMatchObject({ uid: p1.uid, exp: fullExp });
    expect(rewards.partyExp?.[1]).toMatchObject({ uid: p2.uid, exp: fullExp });
  });

  it("single-pokemon party yields only that one (no bench to share with)", () => {
    // 파티가 한 마리뿐이면 벤치가 없어 Exp Share가 적용될 대상이 없다 — 종전과 동일하게
    // 그 한 마리만 풀 EXP를 받는다. (벤치 생존자 분배는 아래 Exp Share describe에서 검증.)
    const solo = createPokemon("charizard", 40);
    const start = solo.exp;
    const user = makePartyUser([solo]);

    const rewards = grantBattleRewards(user, [solo], wild, config, opts);

    const fullExp = calculateBattleExp(wild, 40, config);
    expect(solo.exp).toBe(start + fullExp);
    expect(rewards.partyExp).toHaveLength(1);
    expect(rewards.partyExp?.[0].uid).toBe(solo.uid);
  });

  it("fainted (hp<=0) participants get no exp and are omitted from partyExp", () => {
    const alive = createPokemon("charizard", 40);
    const fainted = createPokemon("blastoise", 40);
    fainted.hp = 0;
    const startFainted = fainted.exp;
    const user = makePartyUser([alive, fainted]);

    const rewards = grantBattleRewards(user, [alive, fainted], wild, config, opts);

    expect(fainted.exp).toBe(startFainted);
    expect(rewards.partyExp).toHaveLength(1);
    expect(rewards.partyExp?.[0].uid).toBe(alive.uid);
  });

  it("propagates level-ups for each participant in partyExp", () => {
    const p1 = createPokemon("caterpie", 3);
    const p2 = createPokemon("weedle", 3);
    const user = makePartyUser([p1, p2]);
    const bigExpConfig = { ...config, expMultiplier: 1000 };

    const rewards = grantBattleRewards(user, [p1, p2], { species: "charizard", level: 50 }, bigExpConfig, opts);

    for (const p of [p1, p2]) {
      const entry = rewards.partyExp?.find((e) => e.uid === p.uid);
      expect(entry?.leveledUp).toBe(true);
      expect(entry?.newLevel).toBeGreaterThan(3);
      expect(p.level).toBe(entry?.newLevel);
    }
  });
});

describe("grantBattleRewards Exp Share (benched party members)", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const wild = { species: "pidgey", level: 10 } as const;
  const opts = { random: () => 0.99, now }; // no drop, no pokerus

  it("gives benched survivors floor(exp*ratio), participants full, and fainted 0", () => {
    const active = createPokemon("charizard", 40); // 참여·생존 → 풀 EXP
    const benchAlive = createPokemon("blastoise", 40); // 벤치·생존 → 분배분
    const benchFainted = createPokemon("venusaur", 40); // 벤치·기절 → 0
    benchFainted.hp = 0;
    const startActive = active.exp;
    const startBenchAlive = benchAlive.exp;
    const startBenchFainted = benchFainted.exp;
    const user = makePartyUser([active, benchAlive, benchFainted]);

    const rewards = grantBattleRewards(user, [active], wild, config, opts);

    const fullExp = calculateBattleExp(wild, 40, config);
    const sharedExp = Math.floor(fullExp * config.expShareRatio);
    expect(sharedExp).toBeGreaterThan(0);

    expect(active.exp).toBe(startActive + fullExp); // 참여 생존자 = 풀
    expect(benchAlive.exp).toBe(startBenchAlive + sharedExp); // 벤치 생존자 = floor(full*ratio)
    expect(benchFainted.exp).toBe(startBenchFainted); // 벤치 기절 = 0

    // partyExp: 참여자 먼저(헤드라인 유지), 벤치 생존자는 뒤에. 벤치 기절자는 제외.
    expect(rewards.partyExp).toHaveLength(2);
    expect(rewards.partyExp?.[0]).toMatchObject({ uid: active.uid, exp: fullExp });
    expect(rewards.partyExp?.[1]).toMatchObject({ uid: benchAlive.uid, exp: sharedExp });
    expect(rewards.partyExp?.some((e) => e.uid === benchFainted.uid)).toBe(false);
  });

  it("shares nothing when expShareRatio is 0 (participants only)", () => {
    const active = createPokemon("charizard", 40);
    const bench = createPokemon("blastoise", 40);
    const startBench = bench.exp;
    const user = makePartyUser([active, bench]);
    const noShare = { ...config, expShareRatio: 0 };

    const rewards = grantBattleRewards(user, [active], wild, noShare, opts);

    expect(bench.exp).toBe(startBench); // 분배 없음
    expect(rewards.partyExp).toHaveLength(1);
    expect(rewards.partyExp?.[0].uid).toBe(active.uid);
  });

  it("never sets evolvedInto (auto-evolution removed) even on a level-up", () => {
    const p = createPokemon("caterpie", 3);
    const user = makePartyUser([p]);
    const bigExpConfig = { ...config, expMultiplier: 1000 };

    const rewards = grantBattleRewards(user, [p], { species: "charizard", level: 50 }, bigExpConfig, opts);

    // 레벨업은 일어나되(진화 임계 통과 가능) 자동 진화는 하지 않는다.
    expect(rewards.partyExp?.[0]?.evolvedInto).toBeNull();
    expect(rewards.evolvedInto).toBeNull();
  });
});
