import { describe, expect, it } from "vitest";
import {
  BOSSES,
  buildBossWild,
  computeBossLevel,
  getCurrentBoss,
  getIsoCalendarWeek,
  getIsoWeek,
  getIsoWeekLabel,
  grantBossRewardOnce,
  type BossDef,
} from "../../src/game/weekly-boss.js";
import { buildStats } from "../../src/game/pokemon-stats.js";
import { getSpeciesByName } from "../../src/game/data-loader.js";
import type { UserData } from "../../../../shared/types.js";

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

describe("getIsoCalendarWeek / getIsoWeekLabel", () => {
  it("gives a small human calendar week number, not the raw epoch-week index (regression: was showing e.g. '2948차')", () => {
    const d = new Date(2026, 0, 5); // 2026-01-05, ISO 2026-W02 Monday
    const { year, week } = getIsoCalendarWeek(d);
    expect(year).toBe(2026);
    expect(week).toBeGreaterThanOrEqual(1);
    expect(week).toBeLessThanOrEqual(53);
    // 절대 인덱스(getIsoWeek)는 수천 단위로 크지만, 캘린더 주는 항상 1~53 범위다.
    expect(getIsoWeek(d)).toBeGreaterThan(53);
    expect(getIsoWeekLabel(d)).toBe(`${year}년 ${week}주차`);
  });

  it("increments the calendar week by 1 across a normal week boundary", () => {
    const w1 = getIsoCalendarWeek(mondayOfWeek(0));
    const w2 = getIsoCalendarWeek(mondayOfWeek(1));
    if (w2.year === w1.year) {
      expect(w2.week).toBe(w1.week + 1);
    } else {
      // 연 경계를 넘는 드문 케이스 — 새해 첫 주로 리셋.
      expect(w2.week).toBe(1);
    }
  });
});

describe("computeBossLevel", () => {
  const boss: BossDef = {
    id: "level-test", name: "", description: "", gimmick: "",
    species: "metagross", level: 75, moves: ["tackle"],
    reward: { gameMoney: 0, item: null },
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
      description: "",
      gimmick: "",
      species: "metagross",
      level,
      moves: ["meteor-mash", "earthquake"],
      statMultiplier: { hp: 3, attack: 2 },
      reward: { gameMoney: 0, item: null },
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
    description: "",
    gimmick: "",
    species: "metagross",
    level: 70,
    moves: ["meteor-mash"],
    reward: { gameMoney: 2500, item: { id: "assault-vest", qty: 1 } },
  };

  // 포인트는 이제 grantBossRewardOnce가 아니라 boss-clears-store의 순위 등록이 지급한다
  // (별도 boss-clears-store.test.ts). 여기선 gameMoney/item/멱등 가드만 검증한다.
  it("grants the reward once and records the defeat", () => {
    const user = makeUser();
    const week = 3000;

    const first = grantBossRewardOnce(user, boss, week);
    expect(first.granted).toBe(true);
    expect(first.alreadyDefeated).toBe(false);
    expect(user.points).toBe(100); // 미변경(포인트는 boss-clears-store 몫)
    expect(user.gameMoney).toBe(2550); // 50 + 2500
    expect(user.inventory["assault-vest"]).toBe(1);
    expect(user.bossDefeat).toEqual({ week, bossId: boss.id });
  });

  it("does NOT grant twice in the same week (idempotent guard)", () => {
    const user = makeUser();
    const week = 3000;

    grantBossRewardOnce(user, boss, week);
    const second = grantBossRewardOnce(user, boss, week);

    expect(second.granted).toBe(false);
    expect(second.alreadyDefeated).toBe(true);
    // 재화/아이템이 두 번 지급되지 않는다.
    expect(user.gameMoney).toBe(2550);
    expect(user.inventory["assault-vest"]).toBe(1);
  });

  it("grants again in a different week", () => {
    const user = makeUser();
    grantBossRewardOnce(user, boss, 3000);
    const nextWeek = grantBossRewardOnce(user, boss, 3001);

    expect(nextWeek.granted).toBe(true);
    expect(user.gameMoney).toBe(5050); // 50 + 2500 + 2500
    expect(user.inventory["assault-vest"]).toBe(2);
    expect(user.bossDefeat).toEqual({ week: 3001, bossId: boss.id });
  });
});
