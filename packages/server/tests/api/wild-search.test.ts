import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

// POST /game/wild/search — 포인트 소비 야생 탐색

describe("POST /api/game/wild/search", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  it("포인트가 부족하면 400 (신규 유저는 0P)", async () => {
    const { token } = await app.registerAndLogin();
    const res = await app.authed(token).post("/api/game/wild/search");
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("포인트");
  });

  it("포인트를 차감하고 조우 이벤트를 생성한다", async () => {
    const { token, userId } = await app.registerAndLogin();
    await app.admin().post("/api/admin/test/give-points", { userId, amount: 250 });

    const res = await app.authed(token).post("/api/game/wild/search");
    expect(res.status).toBe(201);

    const body = res.body as {
      event: { id: string; type: string; pokemon: { species: string; level: number } };
      cost: number;
      remainingPoints: number;
    };
    expect(body.cost).toBe(100); // 기본값
    expect(body.remainingPoints).toBe(150);
    expect(body.event.type).toBe("wild_encounter");
    expect(body.event.pokemon.species).toBeTruthy();

    // 생성된 이벤트가 /game/events에 노출되고, 탐색 비용/잔액도 함께 내려온다
    const events = await app.authed(token).get("/api/game/events");
    expect(events.status).toBe(200);
    const eventsBody = events.body as {
      events: { id: string }[];
      searchCost: number;
      points: number;
    };
    expect(eventsBody.events.some((e) => e.id === body.event.id)).toBe(true);
    expect(eventsBody.searchCost).toBe(100);
    expect(eventsBody.points).toBe(150);
  });

  it("연속 탐색 시 매번 차감된다", async () => {
    const { token, userId } = await app.registerAndLogin();
    await app.admin().post("/api/admin/test/give-points", { userId, amount: 200 });

    expect((await app.authed(token).post("/api/game/wild/search")).status).toBe(201);
    expect((await app.authed(token).post("/api/game/wild/search")).status).toBe(201);
    // 0P 남음 → 세 번째는 실패
    expect((await app.authed(token).post("/api/game/wild/search")).status).toBe(400);
  });
});
