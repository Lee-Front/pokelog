import { describe, expect, it } from "vitest";
import { distributeWorldBossRewards } from "../../src/game/world-boss.js";
import { DEFAULT_CONFIG } from "../../src/storage/config-store.js";
import type { UserData, WorldBossContribution } from "../../../../shared/types.js";

// distributeWorldBossRewards의 개인별 배분식(임계·하한·상한)을 순수 함수 단위로 검증한다.
// 배분 로직은 각 유저의 worldBossCapture를 in-place로 세팅하고, 실제 배분된 유저 요약을 반환한다.

const cfg = DEFAULT_CONFIG.worldBoss; // minContributionPct 0.05, maxBalls 20, minBalls 2

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
    expect(shares).toEqual([{ userId: "solo", ballAttempts: cfg.maxBalls }]);
    expect(user.worldBossCapture?.ballAttempts).toBe(cfg.maxBalls);
    expect(user.worldBossCapture?.bossId).toBe("boss-1");
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
    // share = 0.05(=minContributionPct) → round(0.05×20)=1 이지만 minBalls(2)로 올린다.
    const a = makeUser("a");
    const b = makeUser("b");
    const shares = distributeWorldBossRewards(
      [a, b],
      { a: contribution(5), b: contribution(95) },
      boss,
      cfg,
      "greatball",
    );
    expect(shares.find((s) => s.userId === "a")?.ballAttempts).toBe(cfg.minBalls);
    expect(a.worldBossCapture?.ballAttempts).toBe(cfg.minBalls);
  });

  it("scales proportionally between floor and cap", () => {
    // 두 명이 정확히 반반(share=0.5) → round(0.5×20)=10, minBalls~maxBalls 범위 안이라 그대로.
    const a = makeUser("a");
    const b = makeUser("b");
    distributeWorldBossRewards(
      [a, b],
      { a: contribution(50), b: contribution(50) },
      boss,
      cfg,
      "greatball",
    );
    expect(a.worldBossCapture?.ballAttempts).toBe(10);
    expect(b.worldBossCapture?.ballAttempts).toBe(10);
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
