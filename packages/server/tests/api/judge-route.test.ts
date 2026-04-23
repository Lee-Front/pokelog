import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("GET /api/user/judge/:uid", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("returns IV appraisal for a freshly created pokemon", async () => {
    const { token, userId } = await t.registerAndLogin("judgeuser", "charmander");

    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "bulbasaur",
      level: 10,
    });
    expect(give.status).toBe(200);
    const uid = give.body.pokemon.uid;

    const res = await t.authed(token).get(`/api/user/judge/${uid}`);
    expect(res.status).toBe(200);
    expect(res.body.legacy).toBe(false);
    expect(res.body.species).toBe("bulbasaur");
    expect(typeof res.body.total).toBe("number");
    expect(res.body.total).toBeGreaterThanOrEqual(0);
    expect(res.body.total).toBeLessThanOrEqual(186);

    const verdicts = ["환상적이야!", "정말 대단해!", "꽤 괜찮아", "좀 더 노력해볼까"];
    expect(verdicts).toContain(res.body.verdict);

    for (const stat of ["hp", "attack", "defense", "spAttack", "spDefense", "speed"]) {
      expect(res.body.perStat[stat]).toBeDefined();
      expect(res.body.perStat[stat].value).toBeGreaterThanOrEqual(0);
      expect(res.body.perStat[stat].value).toBeLessThanOrEqual(31);
      expect(typeof res.body.perStat[stat].verdict).toBe("string");
    }
  });

  it("returns 404 for an unknown pokemon UID", async () => {
    const { token } = await t.registerAndLogin("judgeuser2", "charmander");
    const res = await t.authed(token).get(`/api/user/judge/nonexistent-uid`);
    expect(res.status).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const res = await t.request.get("/api/user/judge/any-uid");
    expect(res.status).toBe(401);
  });
});
