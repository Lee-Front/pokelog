/**
 * Scenario 32 — Ranking System.
 *
 *  - Multiple users with varied points/exp/level appear in /api/social/ranking
 *  - Default sort is by exp (desc); ?by=points sorts by points
 *  - PvP rating list (/api/social/ranking/pvp) sorts by Elo
 *  - Storage pokemon counted in topLevel
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import { recordMatch } from "../../src/pvp/pvp-store.js";
import { saveUser, getUser } from "../../src/storage/user-store.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";

describe("Scenario 32 — Ranking System", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("default ranking sorted by totalExp (desc)", async () => {
    await createTestUser({
      uid: "rankExpA", nickname: "ExpA",
      initialExp: 1000, initialPoints: 100,
    });
    await createTestUser({
      uid: "rankExpB", nickname: "ExpB",
      initialExp: 5000, initialPoints: 50,
    });
    await createTestUser({
      uid: "rankExpC", nickname: "ExpC",
      initialExp: 100, initialPoints: 999,
    });

    const http = new HttpClient(ctx.app);
    const res = await http.get("/api/social/ranking");
    expect(res.status).toBe(200);
    const list = res.body.ranking as Array<{ nickname: string; totalExp: number }>;
    const indexB = list.findIndex((u) => u.nickname === "ExpB");
    const indexA = list.findIndex((u) => u.nickname === "ExpA");
    const indexC = list.findIndex((u) => u.nickname === "ExpC");
    expect(indexB).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeLessThan(indexA);
    expect(indexA).toBeLessThan(indexC);
  });

  it("?by=points sorts by points (desc)", async () => {
    await createTestUser({
      uid: "rankPtsA", nickname: "PtsA", initialPoints: 100,
    });
    await createTestUser({
      uid: "rankPtsB", nickname: "PtsB", initialPoints: 5000,
    });
    const http = new HttpClient(ctx.app);
    const res = await http.get("/api/social/ranking?by=points");
    expect(res.status).toBe(200);
    const list = res.body.ranking as Array<{ nickname: string; points: number }>;
    const idxB = list.findIndex((u) => u.nickname === "PtsB");
    const idxA = list.findIndex((u) => u.nickname === "PtsA");
    expect(idxB).toBeLessThan(idxA);
  });

  it("topLevel counts storage pokemon", async () => {
    const { user } = await createTestUser({
      uid: "rankTopLvl", nickname: "TopLvl",
      initialPokemon: [{ species: "pikachu", level: 5 }],
    });
    // Add a much higher-level pokemon directly into storage.
    const big = createPokemon("snorlax", 80);
    user.storage.push(big);
    await saveUser(user);

    const http = new HttpClient(ctx.app);
    const res = await http.get("/api/social/ranking?by=level");
    expect(res.status).toBe(200);
    const me = (res.body.ranking as Array<{ nickname: string; topLevel: number }>)
      .find((u) => u.nickname === "TopLvl");
    expect(me).toBeDefined();
    expect(me!.topLevel).toBe(80);
  });

  it("PvP ranking lists users with completed matches sorted by rating", async () => {
    const A = await createTestUser({ uid: "rankPvpA", nickname: "PvpA" });
    const B = await createTestUser({ uid: "rankPvpB", nickname: "PvpB" });
    const C = await createTestUser({ uid: "rankPvpC", nickname: "PvpC" });

    // C beats A; A beats B → C top, A middle, B bottom.
    await recordMatch("rankPvpC", "rankPvpA", "ko");
    await recordMatch("rankPvpA", "rankPvpB", "ko");

    const http = new HttpClient(ctx.app);
    const res = await http.get("/api/social/ranking/pvp");
    expect(res.status).toBe(200);
    const list = res.body.ranking as Array<{ nickname: string; rating: number; wins: number; losses: number }>;
    expect(list.length).toBeGreaterThanOrEqual(3);
    // Sorted descending by rating.
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].rating).toBeGreaterThanOrEqual(list[i].rating);
    }
    // The known users appear and reflect win/loss counts.
    const C2 = list.find((u) => u.nickname === "PvpC");
    const B2 = list.find((u) => u.nickname === "PvpB");
    expect(C2?.wins).toBe(1);
    expect(B2?.losses).toBe(1);
  });

  it("public profile via /api/social/profile/:nickname returns aggregate stats", async () => {
    await createTestUser({
      uid: "rankPub", nickname: "PubProf",
      initialPoints: 4321, initialExp: 9999,
      initialPokemon: [{ species: "snorlax", level: 60 }],
    });
    const http = new HttpClient(ctx.app);
    const res = await http.get("/api/social/profile/PubProf");
    expect(res.status).toBe(200);
    expect(res.body.nickname).toBe("PubProf");
    expect(res.body.points).toBe(4321);
    expect(res.body.totalExp).toBe(9999);
    expect(res.body.topLevel).toBeGreaterThanOrEqual(60);
  });
});
