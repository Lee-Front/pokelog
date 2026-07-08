import { describe, it, expect } from "vitest";
import { ACHIEVEMENTS, evaluateAchievements } from "../../src/game/achievements.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

function makePokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "p-1",
    species: "bulbasaur",
    nickname: null,
    level: 5,
    exp: 0,
    hp: 20,
    maxHp: 20,
    stats: { attack: 10, defense: 10, speed: 10, spAttack: 10, spDefense: 10 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    caughtAt: "2026-01-01",
    ...overrides,
  };
}

// 업적 평가가 읽는 필드만 채운 최소 UserData(정규화는 거치지 않고 raw 상태를 직접 평가한다).
function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    points: 0,
    gameMoney: 0,
    totalExp: 0,
    party: [],
    pokemon: [],
    storage: [],
    pokedex: [],
    seenSpecies: [],
    inventory: {},
    completedAchievements: [],
    ...overrides,
  } as unknown as UserData;
}

/** n개의 서로 다른 종 슬러그 배열(도감/발견 길이 조건용). */
function speciesList(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `species-${i}`);
}

describe("evaluateAchievements", () => {
  it("완료 조건을 만족한 업적만 새로 달성되고 보상이 지급된다", () => {
    // 도감 10종(first-catch + catch-10), 파티 2마리(full-party 미달), 경험치 5만(활동 미달), 승수 0.
    const user = makeUser({
      pokedex: speciesList(10),
      party: ["a", "b"],
      totalExp: 50_000,
    });

    const { newlyCompleted, rewardsGranted } = evaluateAchievements(user, 0);

    expect(newlyCompleted).toEqual(["first-catch", "catch-10"]);
    // first-catch(+100) + catch-10(+300) = 400 포인트.
    expect(rewardsGranted.points).toBe(400);
    expect(rewardsGranted.gameMoney).toBe(0);
    expect(rewardsGranted.items).toEqual([]);
    expect(user.points).toBe(400);
    expect(user.completedAchievements).toEqual(["first-catch", "catch-10"]);
  });

  it("진행도 current 가 조건형은 boolean, 카운트형은 정확한 수치다", () => {
    const user = makeUser({ pokedex: speciesList(10) });
    const { list } = evaluateAchievements(user, 0);
    const byId = Object.fromEntries(list.map((a) => [a.id, a]));

    // 조건형(target 없음) — boolean.
    expect(byId["first-catch"].current).toBe(true);
    expect(byId["first-catch"].completed).toBe(true);
    expect(byId["shiny-trainer"].current).toBe(false);
    expect(byId["shiny-trainer"].completed).toBe(false);

    // 카운트형 — 현재 수치 + target 노출, 미달이면 completed=false.
    expect(byId["catch-50"].current).toBe(10);
    expect(byId["catch-50"].target).toBe(50);
    expect(byId["catch-50"].completed).toBe(false);
  });

  it("재평가는 이미 완료한 업적을 중복 지급하지 않는다(멱등)", () => {
    const user = makeUser({ pokedex: speciesList(10), totalExp: 50_000 });

    const first = evaluateAchievements(user, 0);
    expect(first.newlyCompleted.length).toBeGreaterThan(0);
    const pointsAfterFirst = user.points;

    const second = evaluateAchievements(user, 0);
    expect(second.newlyCompleted).toEqual([]);
    expect(second.rewardsGranted.points).toBe(0);
    expect(user.points).toBe(pointsAfterFirst);
    // 완료 집합은 그대로(중복 추가 없음).
    expect(user.completedAchievements).toEqual(["first-catch", "catch-10"]);
  });

  it("아이템 보상은 인벤토리에 정확한 수량으로 적립된다", () => {
    // 도감 100종(catch-100 → ultraball x5), 이로치 보유(shiny-trainer → leftovers x1),
    // 레벨 100 개체(max-level-50 + max-level-100 → ability-patch x1).
    const user = makeUser({
      pokedex: speciesList(100),
      seenSpecies: speciesList(100),
      storage: [makePokemon({ uid: "shiny-1", level: 100, isShiny: true })],
    });

    const { newlyCompleted, rewardsGranted } = evaluateAchievements(user, 0);

    expect(newlyCompleted).toContain("catch-100");
    expect(newlyCompleted).toContain("shiny-trainer");
    expect(newlyCompleted).toContain("max-level-100");
    expect(user.inventory.ultraball).toBe(5);
    expect(user.inventory.leftovers).toBe(1);
    expect(user.inventory["ability-patch"]).toBe(1);
    expect(rewardsGranted.items).toEqual(
      expect.arrayContaining([
        { id: "ultraball", qty: 5 },
        { id: "leftovers", qty: 1 },
        { id: "ability-patch", qty: 1 },
      ]),
    );
  });

  it("PvP 승수 기반 업적은 주입된 pvpWins 로 평가된다", () => {
    const user = makeUser();

    // 0승 — 대전 업적 미달.
    const none = evaluateAchievements(makeUser(), 0);
    expect(none.newlyCompleted).not.toContain("pvp-first-win");

    // 10승 — 첫 승 + 10승 모두 달성, 진행도 current=10.
    const { list, newlyCompleted } = evaluateAchievements(user, 10);
    expect(newlyCompleted).toContain("pvp-first-win");
    expect(newlyCompleted).toContain("pvp-10-wins");
    const tenWins = list.find((a) => a.id === "pvp-10-wins");
    expect(tenWins?.current).toBe(10);
  });

  it("list 는 정의된 모든 업적을 선언 순서대로 담는다", () => {
    const { list } = evaluateAchievements(makeUser(), 0);
    expect(list.map((a) => a.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));
  });

  it("커밋이 더 이상 경험치를 주지 않으므로 누적경험치 업적은 존재하지 않는다", () => {
    expect(ACHIEVEMENTS.some((a) => a.id === "total-exp-100k")).toBe(false);
    expect(ACHIEVEMENTS.some((a) => a.id === "total-exp-1m")).toBe(false);
  });

  it("주간보스 통산 처치·1위 카운터로 boss 카테고리 업적을 지급한다", () => {
    const user = makeUser({ bossDefeatTotal: 5, bossFirstPlaceTotal: 1 });
    const { newlyCompleted, list } = evaluateAchievements(user, 0);

    expect(newlyCompleted).toEqual(
      expect.arrayContaining(["boss-first-clear", "boss-veteran", "boss-first-place-1"]),
    );
    expect(newlyCompleted).not.toContain("boss-legend");
    expect(list.find((a) => a.id === "boss-veteran")?.current).toBe(5);
  });

  it("현재 파티 레벨 합·완벽개체(IV31)·최대친밀도로 growth 업적을 지급한다", () => {
    const user = makeUser({
      party: ["p-1"],
      pokemon: [
        makePokemon({
          uid: "p-1",
          level: 100,
          ivs: { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 },
          friendship: 255,
        }),
      ],
    });

    const { newlyCompleted } = evaluateAchievements(user, 0);
    expect(newlyCompleted).toContain("max-level-100");
    expect(newlyCompleted).toContain("perfect-iv");
    expect(newlyCompleted).toContain("best-friend");
    expect(newlyCompleted).not.toContain("team-level-300"); // 100 < 300
  });
});
