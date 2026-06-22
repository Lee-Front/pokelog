import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

// POST /game/wild/search — 무료 일괄 야생 롤(보드 교체)

describe("POST /api/game/wild/search", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  it("포인트 없이도 일괄 야생 조우 배치를 생성한다(무료)", async () => {
    const { token } = await app.registerAndLogin();
    const res = await app.authed(token).post("/api/game/wild/search");
    expect(res.status).toBe(200);

    const body = res.body as {
      events: { id: string; type: string; pokemon: { species: string; level: number } }[];
      count: number;
    };
    // 기본 rollCount = 12
    expect(body.count).toBe(12);
    expect(body.events).toHaveLength(12);
    expect(body.events.every((e) => e.type === "wild_encounter")).toBe(true);
    expect(body.events.every((e) => Boolean(e.pokemon.species))).toBe(true);

    // 생성된 배치가 /game/events에 그대로 노출된다
    const events = await app.authed(token).get("/api/game/events");
    expect(events.status).toBe(200);
    const eventsBody = events.body as { events: { id: string }[] };
    const ids = new Set(eventsBody.events.map((e) => e.id));
    expect(body.events.every((e) => ids.has(e.id))).toBe(true);
  });

  it("재탐색은 야생 보드를 통째로 교체한다(이전 야생 조우 제거)", async () => {
    const { token } = await app.registerAndLogin();

    const first = await app.authed(token).post("/api/game/wild/search");
    const firstBody = first.body as { events: { id: string }[] };
    const firstIds = new Set(firstBody.events.map((e) => e.id));

    const second = await app.authed(token).post("/api/game/wild/search");
    expect(second.status).toBe(200);
    const secondBody = second.body as { events: { id: string }[]; count: number };
    expect(secondBody.count).toBe(12);

    // /game/events에는 두 번째 배치만 남고 첫 배치 id는 사라진다
    const events = await app.authed(token).get("/api/game/events");
    const eventsBody = events.body as { events: { id: string }[] };
    expect(eventsBody.events).toHaveLength(12);
    expect(eventsBody.events.some((e) => firstIds.has(e.id))).toBe(false);
    const secondIds = new Set(secondBody.events.map((e) => e.id));
    expect(eventsBody.events.every((e) => secondIds.has(e.id))).toBe(true);
  });

  it("포인트를 차감하지 않는다(무료)", async () => {
    const { token, userId } = await app.registerAndLogin();
    await app.admin().post("/api/admin/test/give-points", { userId, amount: 200 });

    expect((await app.authed(token).post("/api/game/wild/search")).status).toBe(200);
    expect((await app.authed(token).post("/api/game/wild/search")).status).toBe(200);

    const status = await app.authed(token).get("/api/game/status");
    expect((status.body as { points: number }).points).toBe(200);
  });
});
