import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("admin routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    // /provision이 issueToken을 호출하므로 워커 프로세스에 JWT 시크릿이 필요하다
    // (globalSetup의 env는 워커로 전파되지 않음 — 다른 api 테스트와 동일 패턴).
    process.env.POKELOG_JWT_SECRET ??= "vitest-global-secret";
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("rejects requests without admin key", async () => {
    const res = await t.request.get("/api/admin/config");
    // No POKELOG_ADMIN_KEY header → middleware returns 503 or 403
    expect([403, 503]).toContain(res.status);
  });

  it("rejects requests with wrong admin key", async () => {
    const res = await t.request
      .get("/api/admin/config")
      .set("x-admin-key", "wrong-key");
    expect(res.status).toBe(403);
  });

  it("GET /config returns server config", async () => {
    const res = await t.admin().get("/api/admin/config");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("meta");
    expect(res.body).toHaveProperty("polling");
    expect(res.body).toHaveProperty("rewards");
  });

  it("POST /repo adds a repository", async () => {
    const res = await t.admin().post("/api/admin/repo", {
      url: "https://github.com/test/repo",
      branches: ["main"],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await t.admin().get("/api/admin/repos");
    expect(list.status).toBe(200);
    expect(list.body.repos.some((r: { url: string }) => r.url === "https://github.com/test/repo")).toBe(true);
  });

  it("DELETE /repo removes a repository", async () => {
    await t.admin().post("/api/admin/repo", {
      url: "https://github.com/test/deleteme",
      branches: ["main"],
    });

    const del = await t.request
      .delete("/api/admin/repo")
      .set("x-admin-key", "test-admin-key")
      .send({ url: "https://github.com/test/deleteme" });
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const list = await t.admin().get("/api/admin/repos");
    expect(list.body.repos.some((r: { url: string }) => r.url === "https://github.com/test/deleteme")).toBe(false);
  });

  it("POST /test/give-points gives points to user", async () => {
    const { token, userId } = await t.registerAndLogin("pointsuser", "charmander");

    const res = await t.admin().post("/api/admin/test/give-points", {
      userId,
      amount: 500,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.points).toBe(500);

    const status = await t.authed(token).get("/api/game/status");
    expect(status.status).toBe(200);
    expect(status.body.points).toBe(500);
  });

  it("POST /test/give-item gives item to user", async () => {
    const { token, userId } = await t.registerAndLogin("itemuser", "charmander");

    const res = await t.admin().post("/api/admin/test/give-item", {
      userId,
      item: "pokeball",
      quantity: 3,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const inv = await t.authed(token).get("/api/game/inventory");
    expect(inv.status).toBe(200);
    // inventory is Record<string, number>, starter gets 5 pokeballs + 3 given = 8
    expect(inv.body.inventory.pokeball).toBe(8);
  });

  it("POST /test/give-pokemon gives pokemon to user", async () => {
    const { token, userId } = await t.registerAndLogin("pokeuser", "charmander");

    const res = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "pikachu",
      level: 10,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.pokemon.species).toBe("pikachu");

    const party = await t.authed(token).get("/api/game/party");
    expect(party.status).toBe(200);
    const pikachu = party.body.party.find((p: { species: string }) => p.species === "pikachu");
    expect(pikachu).toBeDefined();
    expect(pikachu.level).toBe(10);
  });

  it("GET /users returns a balance summary per user", async () => {
    const { userId } = await t.registerAndLogin("summaryuser", "charmander");
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 250 });

    const res = await t.admin().get("/api/admin/users");
    expect(res.status).toBe(200);
    const entry = res.body.find((u: { id: string }) => u.id === userId);
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      id: userId,
      points: 250,
      integrationCount: 0,
    });
    expect(typeof entry.totalExp).toBe("number");
  });

  it("POST /users/:id/recompute returns before/after for a user with no git commits", async () => {
    // A freshly registered user with admin-granted points has no git
    // integrations, so recompute resets the non-commit balance to 0.
    const { userId } = await t.registerAndLogin("recompuser", "charmander");
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 999 });

    const res = await t.admin().post(`/api/admin/users/${userId}/recompute`);
    expect(res.status).toBe(200);
    expect(res.body.before.points).toBe(999);
    expect(res.body.after.points).toBe(0); // no commits to re-credit
    expect(res.body.after.totalExp).toBe(0);
  });

  it("POST /users/:id/recompute returns 404 for an unknown user", async () => {
    const res = await t.admin().post("/api/admin/users/nope-not-real/recompute");
    expect(res.status).toBe(404);
  });

  it("POST /provision creates a new PokeLog account and returns a usable token", async () => {
    const loginId = "ssoNewUser";
    const res = await t.admin().post("/api/admin/provision", { loginId });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.pokelogId).toBe(loginId);
    expect(typeof res.body.token).toBe("string");

    // 반환 토큰으로 곧장 게임 API 호출 가능 (별도 로그인 불필요).
    const status = await t.authed(res.body.token).get("/api/game/status");
    expect(status.status).toBe(200);
    expect(status.body.nickname).toBe(loginId); // nickname 기본값 = loginId
  });

  it("POST /provision is idempotent for an existing account (re-issues token, created:false)", async () => {
    const loginId = "ssoExisting";
    const first = await t.admin().post("/api/admin/provision", { loginId });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);

    const second = await t.admin().post("/api/admin/provision", { loginId });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.pokelogId).toBe(loginId);
    expect(typeof second.body.token).toBe("string");

    // 재발급 토큰도 유효해야 한다.
    const status = await t.authed(second.body.token).get("/api/game/status");
    expect(status.status).toBe(200);
  });

  it("POST /provision is idempotent for a self-registered account (no password known)", async () => {
    // 자가가입한 계정도 admin이 비밀번호 없이 토큰만 재발급할 수 있어야 한다.
    const { userId } = await t.registerAndLogin("ssoSelfReg", "squirtle");
    const res = await t.admin().post("/api/admin/provision", { loginId: userId });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.pokelogId).toBe(userId);
    const status = await t.authed(res.body.token).get("/api/game/status");
    expect(status.status).toBe(200);
  });

  it("POST /provision honors an explicit nickname and starter", async () => {
    const res = await t.admin().post("/api/admin/provision", {
      loginId: "ssoCustom",
      nickname: "별명123",
      starter: "charmander",
    });
    expect(res.status).toBe(201);
    const party = await t.authed(res.body.token).get("/api/game/party");
    expect(party.body.party.some((p: { species: string }) => p.species === "charmander")).toBe(true);
    const status = await t.authed(res.body.token).get("/api/game/status");
    expect(status.body.nickname).toBe("별명123");
  });

  it("POST /provision rejects requests without an admin key", async () => {
    const res = await t.request.post("/api/admin/provision").send({ loginId: "ssoNoKey" });
    expect([403, 503]).toContain(res.status);
  });

  it("POST /provision rejects a missing or malformed loginId", async () => {
    const missing = await t.admin().post("/api/admin/provision", {});
    expect(missing.status).toBe(400);
    const bad = await t.admin().post("/api/admin/provision", { loginId: "has space!" });
    expect(bad.status).toBe(400);
  });

  it("ships conservative reward defaults (DEFAULT_CONFIG)", async () => {
    // Asserted against DEFAULT_CONFIG directly; the test harness writes its own
    // config.json so the live /config merges test overrides on top.
    const { DEFAULT_CONFIG } = await import("../../src/storage/config-store.js");
    expect(DEFAULT_CONFIG.rewards.pointsPerByte).toBe(0.01);
    expect(DEFAULT_CONFIG.rewards.expPerByte).toBe(0.05);
    expect(DEFAULT_CONFIG.rewards.combo.maxMultiplier).toBe(1.5);
    expect(DEFAULT_CONFIG.rewards.combo.multipliers).toEqual([1, 1.2, 1.5]);
  });

  it("allows runtime tuning of the combo multipliers curve", async () => {
    const res = await t.admin().put("/api/admin/config", {
      key: "rewards.combo.multipliers",
      value: [1, 1.3, 1.8, 2.5],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const config = await t.admin().get("/api/admin/config");
    expect(config.body.rewards.combo.multipliers).toEqual([1, 1.3, 1.8, 2.5]);
  });

  it("rejects a malformed combo multipliers value", async () => {
    for (const bad of [[], "nope", [1, -2], [1, "x"], [1, 0]]) {
      const res = await t.admin().put("/api/admin/config", {
        key: "rewards.combo.multipliers",
        value: bad as unknown,
      });
      expect(res.status).toBe(400);
    }
  });

  it("allows runtime tuning of pointsPerByte and maxMultiplier", async () => {
    const a = await t.admin().put("/api/admin/config", { key: "rewards.pointsPerByte", value: 0.02 });
    expect(a.status).toBe(200);
    const b = await t.admin().put("/api/admin/config", { key: "rewards.combo.maxMultiplier", value: 2.0 });
    expect(b.status).toBe(200);

    const config = await t.admin().get("/api/admin/config");
    expect(config.body.rewards.pointsPerByte).toBe(0.02);
    expect(config.body.rewards.combo.maxMultiplier).toBe(2.0);
  });

  it("allows runtime tuning of egg tier cost/level/bucket-chances and shinyRate", async () => {
    const edits: Array<[string, unknown]> = [
      ["egg.common.cost", 200],
      ["egg.rare.minLevel", 8],
      ["egg.rare.maxLevel", 20],
      ["egg.legend.legendaryChance", 0.05],
      ["egg.legend.rareChance", 0.4],
      ["shinyRate", 0.01],
    ];
    for (const [key, value] of edits) {
      const res = await t.admin().put("/api/admin/config", { key, value });
      expect(res.status).toBe(200);
    }

    const config = await t.admin().get("/api/admin/config");
    expect(config.body.egg.common.cost).toBe(200);
    expect(config.body.egg.rare.minLevel).toBe(8);
    expect(config.body.egg.rare.maxLevel).toBe(20);
    expect(config.body.egg.legend.legendaryChance).toBe(0.05);
    expect(config.body.egg.legend.rareChance).toBe(0.4);
    expect(config.body.shinyRate).toBe(0.01);
  });

  it("rejects out-of-range egg/shiny edits", async () => {
    const bad: Array<[string, unknown]> = [
      ["egg.common.cost", -5], // cost < 0
      ["egg.common.minLevel", 0], // level < 1
      ["egg.common.maxLevel", 101], // level > 100
      ["egg.rare.legendaryChance", 1.2], // chance > 1
      ["egg.rare.rareChance", -0.1], // chance < 0
      ["shinyRate", 2], // shinyRate > 1
      ["shinyRate", -0.1], // shinyRate < 0
    ];
    for (const [key, value] of bad) {
      const res = await t.admin().put("/api/admin/config", { key, value });
      expect(res.status).toBe(400);
    }
  });

  it("rejects bucket chances whose legendary + rare sum exceeds 1", async () => {
    // default common rareChance=0.12; setting legendaryChance high enough to push
    // the sum over 1 must fail (would make the derived common chance negative).
    const res = await t.admin().put("/api/admin/config", { key: "egg.common.legendaryChance", value: 0.95 });
    expect(res.status).toBe(400);
  });

  it("rejects an egg level range where min exceeds max", async () => {
    // default common is [1,6]; setting min above the stored max must fail
    const res = await t.admin().put("/api/admin/config", { key: "egg.common.minLevel", value: 50 });
    expect(res.status).toBe(400);
  });

  it("ships default egg/shiny config (DEFAULT_CONFIG)", async () => {
    const { DEFAULT_CONFIG } = await import("../../src/storage/config-store.js");
    expect(DEFAULT_CONFIG.egg.common).toEqual({
      cost: 120,
      minLevel: 1,
      maxLevel: 6,
      legendaryChance: 0.002,
      rareChance: 0.12,
    });
    expect(DEFAULT_CONFIG.egg.legend.cost).toBe(3200);
    expect(DEFAULT_CONFIG.egg.legend.legendaryChance).toBe(0.03);
    expect(DEFAULT_CONFIG.shinyRate).toBeCloseTo(1 / 4096);
  });

  it("allows runtime tuning of pvp elo", async () => {
    const edits: Array<[string, unknown]> = [
      ["pvp.elo.start", 1200],
      ["pvp.elo.k", 24],
    ];
    for (const [key, value] of edits) {
      const res = await t.admin().put("/api/admin/config", { key, value });
      expect(res.status).toBe(200);
    }
    const config = await t.admin().get("/api/admin/config");
    expect(config.body.pvp.elo.start).toBe(1200);
    expect(config.body.pvp.elo.k).toBe(24);
  });

  it("rejects out-of-range pvp edits", async () => {
    const bad: Array<[string, unknown]> = [
      ["pvp.elo.start", 0],   // not > 0
      ["pvp.elo.k", -5],      // not > 0
    ];
    for (const [key, value] of bad) {
      const res = await t.admin().put("/api/admin/config", { key, value });
      expect(res.status).toBe(400);
    }
  });

  it("ships default pvp config (DEFAULT_CONFIG)", async () => {
    const { DEFAULT_CONFIG } = await import("../../src/storage/config-store.js");
    expect(DEFAULT_CONFIG.pvp).toEqual({
      elo: { start: 1000, k: 32 },
    });
  });
});
