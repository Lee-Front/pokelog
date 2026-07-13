import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";
import type { WeeklyBossCapture } from "../../../../shared/types.js";

/**
 * 주간보스 포획 엔드포인트(/api/game/weekly-boss/capture) 통합 테스트 — 월드보스 포획과 동형이지만
 * 시도권 출처(주간보스 처치 랭킹)만 다르다. 실제 클리어(보스 처치)는 HP가 커서 결정적으로 못 이기므로,
 * user-store로 weeklyBossCapture를 직접 심어(finishWin이 실는 것과 같은 형태) 소진 경로만 검증한다.
 *
 * - 성공: 개체 지급(파티/보관함·도감) + 시도권 소멸.
 * - 실패: ballAttempts 1 차감.
 * - 시도권 소진 후(또는 없음) 포획 시도 → 400.
 * - GET /boss가 weeklyBossCapture를 노출한다.
 */
describe("weekly-boss capture API", () => {
  let t: TestApp;
  // setupTestApp가 vi.resetModules 후 앱을 로드하므로, user-store도 setup 이후에 동적 import해
  // 앱과 같은 POKELOG_DATA_DIR(같은 파일)로 읽고 쓴다. 시드용으로만 쓴다.
  let store: typeof import("../../src/storage/user-store.js");

  beforeAll(async () => {
    t = await setupTestApp();
    store = await import("../../src/storage/user-store.js");
  });

  afterAll(() => {
    t?.cleanup();
  });

  // finishWin이 실는 것과 동일한 형태의 시도권을 유저 파일에 직접 심는다(레벨 5·1마리 지급).
  async function seedCapture(userId: string, ballAttempts: number, species = "pikachu"): Promise<void> {
    const user = await store.getUser(userId);
    if (!user) throw new Error("seed: user not found");
    const capture: WeeklyBossCapture = {
      species,
      variantId: null,
      level: 5,
      shiny: false,
      ballItem: "greatball",
      ballAttempts,
      bossId: "steel-wall",
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
    user.weeklyBossCapture = capture;
    await store.saveUser(user);
  }

  it("GET /boss exposes weeklyBossCapture (null when none, the object once seeded)", async () => {
    const { token, userId } = await t.registerAndLogin("wkbcapview", "charmander");
    const api = t.authed(token);

    const before = await api.get("/api/game/boss");
    expect(before.status).toBe(200);
    expect(before.body.weeklyBossCapture).toBeNull();

    await seedCapture(userId, 3);
    const after = await api.get("/api/game/boss");
    expect(after.body.weeklyBossCapture).not.toBeNull();
    expect(after.body.weeklyBossCapture.ballAttempts).toBe(3);
    expect(after.body.weeklyBossCapture.species).toBe("pikachu");
  });

  it("returns 400 when there is no capture allotment", async () => {
    const { token } = await t.registerAndLogin("wkbcapnone", "charmander");
    const res = await t.authed(token).post("/api/game/weekly-boss/capture");
    expect(res.status).toBe(400);
  });

  it("capturing eventually grants a pokemon (party/pokedex) and clears the field; empties on exhaustion → 400", async () => {
    const { token, userId } = await t.registerAndLogin("wkbcaprun", "charmander");
    const api = t.authed(token);

    const attempts = 8;
    await seedCapture(userId, attempts, "pikachu");

    let caught = false;
    let lastAttempts = attempts;
    for (let i = 0; i < attempts && !caught; i++) {
      const cap = await api.post("/api/game/weekly-boss/capture");
      expect(cap.status).toBe(200);
      if (cap.body.caught) {
        caught = true;
        expect(cap.body.pokemon.species).toBe("pikachu");
        expect(cap.body.ballAttempts).toBe(0);
      } else {
        // 실패 → 시도권 정확히 1 차감.
        expect(cap.body.ballAttempts).toBe(lastAttempts - 1);
        lastAttempts = cap.body.ballAttempts;
      }
    }

    const view = await api.get("/api/game/boss");
    if (caught) {
      // 성공 → 시도권 소멸 + 도감/보유 반영.
      expect(view.body.weeklyBossCapture).toBeNull();
      const dex = await api.get("/api/game/pokedex");
      expect(dex.status).toBe(200);
      expect(dex.body.caught).toContain("pikachu");
    }

    // 시도권 소진(또는 성공 소멸) 후 추가 시도는 400.
    if (!view.body.weeklyBossCapture) {
      const noMore = await api.post("/api/game/weekly-boss/capture");
      expect(noMore.status).toBe(400);
    }
  });

  it("a single failed attempt decrements ballAttempts by exactly 1 (persisted to GET /boss)", async () => {
    // 실패를 결정적으로 관찰하기 위해 여러 번 심어 최소 1회 실패를 확보한다(확률 0.3 기반).
    const { token, userId } = await t.registerAndLogin("wkbcapdec", "charmander");
    const api = t.authed(token);

    let sawFail = false;
    for (let round = 0; round < 12 && !sawFail; round++) {
      await seedCapture(userId, 2, "pikachu");
      const cap = await api.post("/api/game/weekly-boss/capture");
      expect(cap.status).toBe(200);
      if (!cap.body.caught) {
        sawFail = true;
        expect(cap.body.ballAttempts).toBe(1);
        const view = await api.get("/api/game/boss");
        expect(view.body.weeklyBossCapture.ballAttempts).toBe(1);
      }
    }
    expect(sawFail).toBe(true);
  });
});
