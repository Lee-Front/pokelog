import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

// DELETE /game/events/:id — 야생 조우 삭제(dismiss)
// GET /game/events — 각 pokemon에 종족 속성(types) 포함

describe("야생 이벤트 삭제 + types", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  async function makeEncounter(): Promise<{ token: string; eventId: string }> {
    const { token } = await app.registerAndLogin();
    // 무료 일괄 야생 롤 — 첫 조우 id를 dismiss 대상으로 쓴다.
    const res = await app.authed(token).post("/api/game/wild/search");
    expect(res.status).toBe(200);
    const events = (res.body as { events: { id: string }[] }).events;
    return { token, eventId: events[0].id };
  }

  it("GET /events 의 각 pokemon에 types 배열이 포함된다", async () => {
    const { token } = await makeEncounter();
    const events = await app.authed(token).get("/api/game/events");
    expect(events.status).toBe(200);
    const body = events.body as { events: { pokemon: { species: string; types: string[] } }[] };
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) {
      expect(Array.isArray(e.pokemon.types)).toBe(true);
    }
  });

  it("DELETE /events/:id 로 조우를 삭제하면 목록에서 사라진다", async () => {
    const { token, eventId } = await makeEncounter();

    const del = await app.authed(token).delete(`/api/game/events/${eventId}`);
    expect(del.status).toBe(200);
    expect((del.body as { ok: boolean }).ok).toBe(true);

    const events = await app.authed(token).get("/api/game/events");
    const body = events.body as { events: { id: string }[] };
    expect(body.events.some((e) => e.id === eventId)).toBe(false);
  });

  it("없는 이벤트 삭제는 404", async () => {
    const { token } = await makeEncounter();
    const del = await app.authed(token).delete("/api/game/events/evt-nonexistent");
    expect(del.status).toBe(404);
  });

  it("인증 없으면 401", async () => {
    const res = await app.request.delete("/api/game/events/evt-x").send();
    expect(res.status).toBe(401);
  });
});
