import { describe, expect, it } from "vitest";
import { distributeWorldBossRewards, buildWorldBossWild } from "../../src/game/world-boss.js";
import { getMoveById } from "../../src/game/data-loader.js";
import { DEFAULT_CONFIG } from "../../src/storage/config-store.js";
import type { UserData, WorldBossContribution } from "../../../../shared/types.js";

// 회귀: 보스 기술이 상태기만 반복하지 않도록 데미지 기술을 우선 선택해야 한다(뮤츠 레이드 파워스웹 스팸 방지).
describe("buildWorldBossWild — 보스 기술 데미지 우선", () => {
  it("뮤츠(고레벨) 레이드가 데미지 기술 위주로 구성된다", () => {
    const wild = buildWorldBossWild("mewtwo", null, 70, { hpMultiplier: 3 });
    const damaging = wild.moves.filter((m) => {
      const md = getMoveById(m.id);
      return md != null && md.category !== "status" && (md.power ?? 0) > 0;
    });
    expect(wild.moves.length).toBeGreaterThan(0);
    expect(damaging.length).toBeGreaterThanOrEqual(3); // 4개 중 대부분 데미지 기술
  });
});

// distributeWorldBossRewards의 개인별 배분식을 순수 함수 단위로 검증한다.
// balls = clamp(round(share × ballPool), minBalls, maxBalls). ballPool(총 풀)이 스케일 기준,
// maxBalls는 1인 상한이라 분리돼 있다 — 덕분에 그룹플레이(혼자 100% 아님)에서도 상위 기여자가 상한에 닿는다.
// 배분 로직은 각 유저의 worldBossCapture를 in-place로 세팅하고, 실제 배분된 유저 요약을 반환한다.

const cfg = DEFAULT_CONFIG.worldBoss; // ballPool 100, minContributionPct 0.05, maxBalls 20, minBalls 2

const boss = {
  bossId: "boss-1",
  species: "mewtwo",
  variantId: null,
  level: 70,
  shiny: false,
  expiresAt: "2026-07-15T00:00:00.000Z",
};

function makeUser(id: string): UserData {
  return { account: { id, nickname: id } } as unknown as UserData;
}

function contribution(damage: number): WorldBossContribution {
  return {
    nickname: "u",
    damage,
    pokemon: { species: "pikachu", variantId: null, shiny: false },
    lastActiveAt: "2026-07-14T00:00:00.000Z",
  };
}

describe("distributeWorldBossRewards", () => {
  it("gives a solo contributor (share=1) the cap (maxBalls)", () => {
    const user = makeUser("solo");
    const shares = distributeWorldBossRewards(
      [user],
      { solo: contribution(100) },
      boss,
      cfg,
      "greatball",
    );
    // round(1 × 100)=100 → 상한 20으로 클램프.
    expect(shares).toEqual([{ userId: "solo", ballAttempts: cfg.maxBalls }]);
    expect(user.worldBossCapture?.ballAttempts).toBe(cfg.maxBalls);
    expect(user.worldBossCapture?.bossId).toBe("boss-1");
  });

  it("lets top contributors reach the cap in group play — the reason ballPool exists", () => {
    // 3명이 40/35/25로 나눠 잡음(아무도 혼자 100% 아님). pool 100 기준 round(40/35/25)=40/35/25
    // → 전부 상한 20에 닿는다. share×maxBalls(옛 공식)였다면 각 8/7/5로 짜게 나왔을 케이스.
    const a = makeUser("a");
    const b = makeUser("b");
    const c = makeUser("c");
    const shares = distributeWorldBossRewards(
      [a, b, c],
      { a: contribution(40), b: contribution(35), c: contribution(25) },
      boss,
      cfg,
      "greatball",
    );
    expect(a.worldBossCapture?.ballAttempts).toBe(cfg.maxBalls);
    expect(b.worldBossCapture?.ballAttempts).toBe(cfg.maxBalls);
    expect(c.worldBossCapture?.ballAttempts).toBe(cfg.maxBalls);
    expect(shares).toHaveLength(3);
  });

  it("scales proportionally below the cap", () => {
    // a=10%, b=90%. pool 100 → a: round(10)=10(상한 미만 그대로), b: round(90)=90 → 상한 20.
    const a = makeUser("a");
    const b = makeUser("b");
    distributeWorldBossRewards(
      [a, b],
      { a: contribution(10), b: contribution(90) },
      boss,
      cfg,
      "greatball",
    );
    expect(a.worldBossCapture?.ballAttempts).toBe(10);
    expect(b.worldBossCapture?.ballAttempts).toBe(cfg.maxBalls);
  });

  it("skips a below-threshold contributor entirely (no capture, no ball)", () => {
    // share = 1/100 = 0.01 < minContributionPct(0.05) → 자격 미달.
    const small = makeUser("small");
    const big = makeUser("big");
    const shares = distributeWorldBossRewards(
      [small, big],
      { small: contribution(1), big: contribution(99) },
      boss,
      cfg,
      "greatball",
    );
    expect(shares.some((s) => s.userId === "small")).toBe(false);
    expect(small.worldBossCapture).toBeUndefined();
    // 임계 이상인 big은 정상 배분받는다(share=0.99 → 상한 20).
    expect(big.worldBossCapture?.ballAttempts).toBe(cfg.maxBalls);
  });

  it("floors an eligible-but-small share at minBalls", () => {
    // 작은 풀(10)로 하한이 실제로 바인딩되는 케이스: a=6%(임계 이상) → round(0.06×10)=round(0.6)=1
    // 이지만 minBalls(2)로 올린다.
    const smallPool = { ...cfg, ballPool: 10 };
    const a = makeUser("a");
    const b = makeUser("b");
    const shares = distributeWorldBossRewards(
      [a, b],
      { a: contribution(6), b: contribution(94) },
      boss,
      smallPool,
      "greatball",
    );
    expect(shares.find((s) => s.userId === "a")?.ballAttempts).toBe(cfg.minBalls);
    expect(a.worldBossCapture?.ballAttempts).toBe(cfg.minBalls);
  });

  it("returns nothing when there is no damage", () => {
    const user = makeUser("z");
    const shares = distributeWorldBossRewards(
      [user],
      { z: contribution(0) },
      boss,
      cfg,
      "greatball",
    );
    expect(shares).toEqual([]);
    expect(user.worldBossCapture).toBeUndefined();
  });

  it("is idempotent per user for the same boss", () => {
    const user = makeUser("solo");
    user.worldBossCapture = {
      species: "mewtwo",
      variantId: null,
      level: 70,
      shiny: false,
      ballItem: "greatball",
      ballAttempts: 3,
      bossId: "boss-1",
      expiresAt: boss.expiresAt,
    };
    const shares = distributeWorldBossRewards(
      [user],
      { solo: contribution(100) },
      boss,
      cfg,
      "greatball",
    );
    // 이미 이 보스의 배분을 가졌으므로 건너뛴다(값 유지).
    expect(shares).toEqual([]);
    expect(user.worldBossCapture?.ballAttempts).toBe(3);
  });
});
