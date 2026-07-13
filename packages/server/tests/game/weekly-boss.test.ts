import { describe, expect, it } from "vitest";
import {
  BOSSES,
  buildBossWild,
  computeBossLevel,
  getCurrentBoss,
  getDisplayWeekNumber,
  getIsoWeek,
  getIsoWeekLabel,
  grantBossRewardOnce,
  ballsForRank,
  type BossDef,
} from "../../src/game/weekly-boss.js";
import { buildStats } from "../../src/game/pokemon-stats.js";
import { getSpeciesByName } from "../../src/game/data-loader.js";
import { DEFAULT_CONFIG } from "../../src/storage/config-store.js";
import type { UserData, WeeklyBossCapture } from "../../../../shared/types.js";

// 주 경계(월요일)마다 정확히 1씩 증가하는 연속 주 인덱스를 쓴다. 2026-01-05는 월요일.
function mondayOfWeek(i: number): Date {
  return new Date(2026, 0, 5 + 7 * i);
}

describe("getIsoWeek", () => {
  it("is stable within the same calendar day and increments by 1 per week", () => {
    const a = mondayOfWeek(0);
    const sameDayLater = new Date(2026, 0, 5, 23, 59);
    expect(getIsoWeek(a)).toBe(getIsoWeek(sameDayLater));
    expect(getIsoWeek(mondayOfWeek(1))).toBe(getIsoWeek(mondayOfWeek(0)) + 1);
    expect(getIsoWeek(mondayOfWeek(5))).toBe(getIsoWeek(mondayOfWeek(0)) + 5);
  });
});

describe("getDisplayWeekNumber / getIsoWeekLabel", () => {
  it("starts at 1 for the week this feature launched (2026-07-06), not the raw epoch-week index (regression: was showing e.g. '2948차')", () => {
    const launchMonday = new Date(2026, 6, 6);
    expect(getDisplayWeekNumber(launchMonday)).toBe(1);
    expect(getIsoWeekLabel(launchMonday)).toBe("1주차");
    // 절대 인덱스(getIsoWeek)는 수천 단위로 크지만, 표시용 주차는 1부터 시작한다.
    expect(getIsoWeek(launchMonday)).toBeGreaterThan(53);
  });

  it("increments by 1 per week after launch", () => {
    const launchMonday = new Date(2026, 6, 6);
    const nextMonday = new Date(2026, 6, 13);
    expect(getDisplayWeekNumber(nextMonday)).toBe(getDisplayWeekNumber(launchMonday) + 1);
    expect(getIsoWeekLabel(nextMonday)).toBe("2주차");
  });

  it("is stable within the same calendar day", () => {
    const launchMonday = new Date(2026, 6, 6);
    const sameDayLater = new Date(2026, 6, 6, 23, 59);
    expect(getDisplayWeekNumber(launchMonday)).toBe(getDisplayWeekNumber(sameDayLater));
  });
});

describe("computeBossLevel", () => {
  const boss: BossDef = {
    id: "level-test", name: "",
    species: "metagross", level: 75, moves: ["tackle"],
  };

  it("never scales below the boss base level", () => {
    expect(computeBossLevel(boss, 0)).toBe(75);
    expect(computeBossLevel(boss, 10)).toBe(75);
  });

  it("scales up to partyMaxLevel + 8 once the party out-levels the boss", () => {
    expect(computeBossLevel(boss, 90)).toBe(98);
  });

  it("caps at 100", () => {
    expect(computeBossLevel(boss, 100)).toBe(100);
  });
});

describe("getCurrentBoss", () => {
  it("is deterministic for the same week", () => {
    const d1 = mondayOfWeek(3);
    const d2 = new Date(2026, 0, 5 + 7 * 3, 18, 30); // same week, later in the day
    expect(getCurrentBoss(d1).id).toBe(getCurrentBoss(d2).id);
  });

  it("rotates every week and cycles back after BOSSES.length weeks", () => {
    const n = BOSSES.length;
    const ids = Array.from({ length: n + 1 }, (_, i) => getCurrentBoss(mondayOfWeek(i)).id);

    // 한 바퀴(0..n-1)는 모두 서로 다른 보스.
    expect(new Set(ids.slice(0, n)).size).toBe(n);
    // 연속한 주는 다른 보스.
    for (let i = 1; i < n; i++) {
      expect(ids[i]).not.toBe(ids[i - 1]);
    }
    // n주 뒤에는 처음 보스로 되돌아온다.
    expect(ids[n]).toBe(ids[0]);
  });
});

describe("buildBossWild", () => {
  it("applies the stat multiplier to base stats (floored) and fills full HP", () => {
    const speciesData = getSpeciesByName("metagross")!;
    const level = 70;
    const base = buildStats(speciesData, level, undefined, null);

    const boss: BossDef = {
      id: "test-mult",
      name: "테스트 보스",
      species: "metagross",
      level,
      moves: ["meteor-mash", "earthquake"],
      statMultiplier: { hp: 3, attack: 2 },
    };

    const wild = buildBossWild(boss);
    // 종족값 정수 × 배수 = 정확히 배수배(floor 무손실).
    expect(wild.maxHp).toBe(base.maxHp * 3);
    expect(wild.stats.attack).toBe(base.stats.attack * 2);
    // 미지정 스탯은 ×1 그대로.
    expect(wild.stats.speed).toBe(base.stats.speed);
    // 항상 풀피로 시작.
    expect(wild.hp).toBe(wild.maxHp);
  });

  it("sets the boss moves (with pp), ability, and held item", () => {
    const boss = BOSSES[0];
    const wild = buildBossWild(boss);

    expect(wild.moves.map((m) => m.id)).toEqual(boss.moves);
    for (const move of wild.moves) {
      expect(move.pp).toBeGreaterThan(0);
      expect(move.maxPp).toBe(move.pp);
    }
    expect(wild.ability).toBe(boss.ability);
    expect(wild.heldItem).toBe(boss.heldItem);
    expect(wild.level).toBe(boss.level);
  });

  it("every roster boss builds without throwing (valid species/moves)", () => {
    for (const boss of BOSSES) {
      const wild = buildBossWild(boss);
      expect(wild.hp).toBe(wild.maxHp);
      expect(wild.moves.length).toBe(boss.moves.length);
    }
  });
});

describe("grantBossRewardOnce", () => {
  function makeUser(): UserData {
    return {
      points: 100,
      gameMoney: 50,
      inventory: {},
    } as unknown as UserData;
  }

  const boss: BossDef = {
    id: "reward-boss",
    name: "보상 보스",
    species: "metagross",
    level: 70,
    moves: ["meteor-mash"],
  };

  // 실제 보상(랭킹 포인트)은 boss-clears-store가 지급한다(별도 boss-clears-store.test.ts).
  // grantBossRewardOnce는 이제 "이번 주 첫 처치인가"만 멱등하게 가드한다.
  it("grants once and records the defeat, without touching any currency", () => {
    const user = makeUser();
    const week = 3000;

    const first = grantBossRewardOnce(user, boss, week);
    expect(first.granted).toBe(true);
    expect(first.alreadyDefeated).toBe(false);
    expect(user.points).toBe(100);
    expect(user.gameMoney).toBe(50);
    expect(user.bossDefeat).toEqual({ week, bossId: boss.id });
  });

  it("does NOT grant twice in the same week (idempotent guard)", () => {
    const user = makeUser();
    const week = 3000;

    grantBossRewardOnce(user, boss, week);
    const second = grantBossRewardOnce(user, boss, week);

    expect(second.granted).toBe(false);
    expect(second.alreadyDefeated).toBe(true);
  });

  it("grants again in a different week", () => {
    const user = makeUser();
    grantBossRewardOnce(user, boss, 3000);
    const nextWeek = grantBossRewardOnce(user, boss, 3001);

    expect(nextWeek.granted).toBe(true);
    expect(user.bossDefeat).toEqual({ week: 3001, bossId: boss.id });
  });
});

describe("ballsForRank", () => {
  const cfg = DEFAULT_CONFIG.weeklyBoss;

  it("gives the ranked ball counts for ranks within captureBallsByRank (1→5, 2→3, 3→2)", () => {
    expect(ballsForRank(1, cfg)).toBe(5);
    expect(ballsForRank(2, cfg)).toBe(3);
    expect(ballsForRank(3, cfg)).toBe(2);
  });

  it("falls back to participationBalls for ranks past the ranked tiers (4, 10 → 1)", () => {
    expect(ballsForRank(4, cfg)).toBe(cfg.participationBalls);
    expect(ballsForRank(4, cfg)).toBe(1);
    expect(ballsForRank(10, cfg)).toBe(1);
  });

  it("respects a custom cfg (ranked array length + participation fallback)", () => {
    const custom = { captureBallsByRank: [9, 4], participationBalls: 2, captureBall: "greatball", captureBaseRate: 0.3 };
    expect(ballsForRank(1, custom)).toBe(9);
    expect(ballsForRank(2, custom)).toBe(4);
    expect(ballsForRank(3, custom)).toBe(2); // 배열 밖 → 참가 보상
  });
});

// finishWin의 주간보스 훅이 이번 주 첫 처치에 user.weeklyBossCapture를 어떻게 구성하는지 검증한다.
// 실제 클리어 경로(/boss/start→/battle/action)는 보스 HP가 커서 결정적으로 못 이기므로(전설/환상은 벤치
// 금지), 훅이 하는 것과 동일한 구성 — grantBossRewardOnce(멱등)로 첫 처치를 인정하고 rank→ballsForRank로
// 시도권을 실는다 — 을 집중 테스트한다. rank는 finishWin이 registerBossClear로 얻는 값(여기선 직접 대입).
describe("weekly-boss first-clear capture grant (finishWin hook shape)", () => {
  const cfg = DEFAULT_CONFIG.weeklyBoss;
  const boss = BOSSES[0];

  function makeUser(): UserData {
    return { points: 0, gameMoney: 0, inventory: {} } as unknown as UserData;
  }

  // finishWin의 grant.granted 분기가 실는 weeklyBossCapture와 같은 형태를 rank로부터 만든다.
  function grantCapture(rank: number): WeeklyBossCapture {
    return {
      species: boss.species,
      variantId: boss.variantId ?? null,
      level: boss.level,
      shiny: false,
      ballItem: cfg.captureBall,
      ballAttempts: ballsForRank(rank, cfg),
      bossId: boss.id,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
  }

  it.each([
    [1, 5],
    [2, 3],
    [3, 2],
    [4, 1],
  ])("first clear at rank %i grants weeklyBossCapture with ballAttempts=%i", (rank, expectedBalls) => {
    const user = makeUser();
    const week = 3100;

    // 첫 처치 인정(멱등 가드) → granted=true일 때만 시도권을 실는다.
    const grant = grantBossRewardOnce(user, boss, week);
    expect(grant.granted).toBe(true);
    user.weeklyBossCapture = grantCapture(rank);

    expect(user.weeklyBossCapture.ballAttempts).toBe(ballsForRank(rank, cfg));
    expect(user.weeklyBossCapture.ballAttempts).toBe(expectedBalls);
    expect(user.weeklyBossCapture.species).toBe(boss.species);
    expect(user.weeklyBossCapture.ballItem).toBe(cfg.captureBall);
    expect(user.weeklyBossCapture.bossId).toBe(boss.id);
    expect(user.weeklyBossCapture.shiny).toBe(false);
  });

  it("does NOT re-grant on a second clear in the same ISO week (idempotent guard)", () => {
    const user = makeUser();
    const week = 3100;

    const first = grantBossRewardOnce(user, boss, week);
    expect(first.granted).toBe(true);
    user.weeklyBossCapture = grantCapture(1);

    // 같은 주 재처치 → granted=false이므로 finishWin은 시도권 재지급 분기를 타지 않는다.
    const second = grantBossRewardOnce(user, boss, week);
    expect(second.granted).toBe(false);
    expect(second.alreadyDefeated).toBe(true);
    // 시도권은 첫 처치 값 그대로(재지급 없음).
    expect(user.weeklyBossCapture.ballAttempts).toBe(5);
  });
});
