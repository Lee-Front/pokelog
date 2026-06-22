/**
 * PvP Phase 2 API — 실제 마운트 경로(/api/pvp/...) 검증.
 * 라우터는 ${prefix}/pvp 에 마운트되므로 ranking/stats는 /api/pvp/ranking · /api/pvp/stats/:userId.
 *
 * 주의: 이 환경의 /auth/register 는 기존 이슈로 500을 반환하므로(다른 api 테스트도 동일),
 * 유저는 user-store로 직접 시드하고 토큰은 issueToken으로 발급해 라우트만 검증한다.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

function makeUser(id: string, nickname: string, party: OwnedPokemon[], points = 0): UserData {
  return {
    account: { id, password: "pw", nickname, createdAt: "2026-04-13T00:00:00.000Z", matchings: {} },
    currentRegion: "default",
    points,
    gameMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: party.map((p) => p.uid),
    pokemon: party,
    eggs: [],
    pokedex: party.map((p) => p.species),
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

describe("PvP Phase 2 routes", () => {
  let t: TestApp;
  let issueToken: (userId: string) => string;
  let saveUser: (u: UserData) => Promise<void>;
  let createPokemon: (species: string, level?: number) => OwnedPokemon;

  beforeAll(async () => {
    // 단일 파일 실행 시에도 토큰 발급이 되도록 시크릿을 보장(글로벌 setup과 동일 기본값).
    process.env.POKELOG_JWT_SECRET ??= "vitest-global-secret";
    t = await setupTestApp();
    // setupTestApp이 POKELOG_DATA_DIR/JWT_SECRET을 세팅한 뒤 모듈을 import 해야 동일 캐시를 쓴다.
    ({ issueToken } = await import("../../src/auth/auth.js"));
    ({ saveUser } = await import("../../src/storage/user-store.js"));
    ({ createPokemon } = await import("../../src/game/pokemon-factory.js"));
  });

  afterAll(() => {
    t?.cleanup();
  });

  async function seed(id: string, points = 0): Promise<string> {
    const mon = createPokemon("bulbasaur", 20);
    mon.moves = [{ id: "tackle", pp: 35, maxPp: 35 }];
    await saveUser(makeUser(id, id, [mon], points));
    return issueToken(id);
  }

  it("GET /api/pvp/ranking 은 빈 리더보드를 반환(신규 서버)", async () => {
    const token = await seed("ranker");
    const res = await t.authed(token).get("/api/pvp/ranking");
    expect(res.status).toBe(200);
    expect(res.body.ranking).toEqual([]);
  });

  it("GET /api/pvp/stats/:userId 은 미등록 유저에 시작 레이팅을 반환", async () => {
    const token = await seed("statuser");
    const res = await t.authed(token).get("/api/pvp/stats/statuser");
    expect(res.status).toBe(200);
    expect(res.body.stats.rating).toBe(1000);
    expect(res.body.stats.wins).toBe(0);
  });

  it("보유 초과 stake는 400으로 거부(에스크로 락 검증)", async () => {
    const aToken = await seed("wagerA", 10);
    await seed("wagerB", 10);
    const res = await t.authed(aToken).post("/api/pvp/challenges", {
      opponentUserId: "wagerB", mode: "single",
      stake: { points: 9999 },
    });
    expect(res.status).toBe(400);
  });

  it("stake 없는 도전(친선)·수락 → active, 에스크로는 빈 채 락", async () => {
    const aToken = await seed("pa", 0);
    const bToken = await seed("pb", 1000);
    const created = await t.authed(aToken).post("/api/pvp/challenges", {
      opponentUserId: "pb", mode: "single",
    });
    expect(created.status).toBe(201);
    expect(created.body.match.stakes.challengerEscrow.locked).toBe(true);
    expect(created.body.match.stakes.challengerEscrow.points).toBe(0);

    const accepted = await t.authed(bToken).post(`/api/pvp/challenges/${created.body.match.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.match.status).toBe("active");
  });

  it("stake 있는 도전(내기) → 자산 락 후 201", async () => {
    const aToken = await seed("wa", 500);
    await seed("wb", 500);
    const created = await t.authed(aToken).post("/api/pvp/challenges", {
      opponentUserId: "wb", mode: "single",
      stake: { points: 100, items: {}, pokemonUids: [] },
    });
    expect(created.status).toBe(201);
    expect(created.body.match.stakes.challengerEscrow.points).toBe(100);
  });

  it("demand 충족 수락 → opponentEscrow에 요구 자산 락", async () => {
    const aToken = await seed("da", 0);
    const bToken = await seed("db", 500);
    const created = await t.authed(aToken).post("/api/pvp/challenges", {
      opponentUserId: "db", mode: "single",
      demand: { points: 150, items: {}, pokemonUids: [] },
    });
    expect(created.status).toBe(201);
    expect(created.body.match.stakes.demand.points).toBe(150);

    const accepted = await t.authed(bToken).post(`/api/pvp/challenges/${created.body.match.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.match.status).toBe("active");
    expect(accepted.body.match.stakes.opponentEscrow.points).toBe(150);
  });

  it("demand 보유 부족 수락은 400으로 거부", async () => {
    const aToken = await seed("ea", 0);
    const bToken = await seed("eb", 10);
    const created = await t.authed(aToken).post("/api/pvp/challenges", {
      opponentUserId: "eb", mode: "single",
      demand: { points: 9999, items: {}, pokemonUids: [] },
    });
    expect(created.status).toBe(201);
    const accepted = await t.authed(bToken).post(`/api/pvp/challenges/${created.body.match.id}/accept`);
    expect(accepted.status).toBe(400);
  });
});
