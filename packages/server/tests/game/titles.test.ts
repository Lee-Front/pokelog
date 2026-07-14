import { describe, it, expect } from "vitest";
import { TITLES, evaluateTitles } from "../../src/game/titles.js";
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

// 칭호 평가가 읽는 필드만 채운 최소 UserData(정규화는 거치지 않고 raw 상태를 직접 평가한다).
function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    account: { id: "u1" },
    points: 0,
    gameMoney: 0,
    party: [],
    pokemon: [],
    storage: [],
    pokedex: [],
    shinyPokedex: [],
    bossDefeatTotal: 0,
    ...overrides,
  } as unknown as UserData;
}

/** n개의 서로 다른 종 슬러그 배열(도감/이로치 도감 길이 조건용). */
function speciesList(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `species-${i}`);
}

/** id로 상태를 빠르게 찾는 헬퍼. */
function statusById(user: UserData, pvpWins = 0, tradesCompleted = 0, activeTitle: string | null = null) {
  const list = evaluateTitles(user, pvpWins, tradesCompleted, activeTitle);
  return Object.fromEntries(list.map((t) => [t.id, t]));
}

describe("evaluateTitles", () => {
  it("도감 1종 이상이면 rookie를 획득한다", () => {
    const byId = statusById(makeUser({ pokedex: speciesList(1) }));
    expect(byId["rookie"].earned).toBe(true);
  });

  it("빈 도감이면 rookie 미획득", () => {
    const byId = statusById(makeUser({ pokedex: [] }));
    expect(byId["rookie"].earned).toBe(false);
  });

  it("이로치 도감 10종이면 shiny-hunter를 획득한다", () => {
    const byId = statusById(makeUser({ shinyPokedex: speciesList(10) }));
    expect(byId["shiny-hunter"].earned).toBe(true);
    // 9종이면 미달.
    const under = statusById(makeUser({ shinyPokedex: speciesList(9) }));
    expect(under["shiny-hunter"].earned).toBe(false);
  });

  it("게임머니 200,000이면 tycoon 획득, 199,999면 미획득", () => {
    expect(statusById(makeUser({ gameMoney: 200_000 }))["tycoon"].earned).toBe(true);
    expect(statusById(makeUser({ gameMoney: 199_999 }))["tycoon"].earned).toBe(false);
  });

  it("보유 개체 레벨 100이면 top-trainer를 획득한다", () => {
    const user = makeUser({ storage: [makePokemon({ uid: "s-1", level: 100 })] });
    expect(statusById(user)["top-trainer"].earned).toBe(true);
    // 99레벨이면 미달.
    const under = makeUser({ storage: [makePokemon({ uid: "s-1", level: 99 })] });
    expect(statusById(under)["top-trainer"].earned).toBe(false);
  });

  it("PvP 25승이 주입되면 champion을 획득한다", () => {
    expect(statusById(makeUser(), 25)["champion"].earned).toBe(true);
    expect(statusById(makeUser(), 24)["champion"].earned).toBe(false);
  });

  it("주간보스 통산 20회면 raid-leader를 획득한다", () => {
    expect(statusById(makeUser({ bossDefeatTotal: 20 }))["raid-leader"].earned).toBe(true);
    expect(statusById(makeUser({ bossDefeatTotal: 19 }))["raid-leader"].earned).toBe(false);
  });

  it("획득한 칭호를 장착하면 그 칭호만 active=true다", () => {
    const byId = statusById(makeUser({ pokedex: speciesList(1) }), 0, 0, "rookie");
    expect(byId["rookie"].earned).toBe(true);
    expect(byId["rookie"].active).toBe(true);
    // 다른 칭호는 active 아님.
    for (const t of TITLES) {
      if (t.id !== "rookie") expect(byId[t.id].active).toBe(false);
    }
  });

  it("미획득 칭호를 activeTitle로 지정해도 active=false로 낮춘다", () => {
    // 도감 1종(collector 미획득)인데 collector 장착 지정.
    const byId = statusById(makeUser({ pokedex: speciesList(1) }), 0, 0, "collector");
    expect(byId["collector"].earned).toBe(false);
    expect(byId["collector"].active).toBe(false);
  });

  it("list는 정의된 모든 칭호를 선언 순서대로 담는다", () => {
    const list = evaluateTitles(makeUser(), 0, 0, null);
    expect(list.map((t) => t.id)).toEqual(TITLES.map((t) => t.id));
  });
});
