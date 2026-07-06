import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

// POST /game/pokemon/:uid/evolve — 온디맨드 진화(레벨업 자동 진화 대체).
// 목록 응답(GET /game/party)이 진화 가능 여부/선택지를 계산해 내려주고, 플레이어가 branchId를
// 골라 evolve 엔드포인트를 호출한다.

describe("POST /api/game/pokemon/:uid/evolve", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  async function giveEligibleCharmander(): Promise<{ token: string; uid: string }> {
    const { token, userId } = await app.registerAndLogin();
    // charmander는 레벨 16에 charmeleon으로 진화 — 적격 개체를 직접 지급한다.
    const given = await app.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "charmander",
      level: 16,
    });
    expect(given.status).toBe(200);
    const uid = (given.body as { pokemon: { uid: string } }).pokemon.uid;
    return { token, uid };
  }

  it("attaches evolutionAvailable/evolutionOptions on GET /game/party", async () => {
    const { token, uid } = await giveEligibleCharmander();

    const party = await app.authed(token).get("/api/game/party");
    expect(party.status).toBe(200);
    const body = party.body as {
      party: {
        uid: string;
        evolutionAvailable: boolean;
        evolutionOptions: { branchId: string; targetSpecies: string; targetName: string }[];
      }[];
    };
    const target = body.party.find((p) => p.uid === uid);
    expect(target).toBeDefined();
    expect(target!.evolutionAvailable).toBe(true);
    expect(target!.evolutionOptions.map((o) => o.targetSpecies)).toContain("charmeleon");
  });

  it("evolves with a valid branchId: species changes and pokedex is updated", async () => {
    const { token, uid } = await giveEligibleCharmander();

    const party = await app.authed(token).get("/api/game/party");
    const partyBody = party.body as {
      party: { uid: string; evolutionOptions: { branchId: string; targetSpecies: string }[] }[];
    };
    const target = partyBody.party.find((p) => p.uid === uid)!;
    const branchId = target.evolutionOptions.find((o) => o.targetSpecies === "charmeleon")!.branchId;

    const res = await app.authed(token).post(`/api/game/pokemon/${uid}/evolve`, { branchId });
    expect(res.status).toBe(200);
    const body = res.body as { message: string; pokemon: { uid: string; species: string } };
    expect(body.pokemon.uid).toBe(uid);
    expect(body.pokemon.species).toBe("charmeleon");
    expect(typeof body.message).toBe("string");

    // 도감(caught·영구)에 진화 대상 종이 추가된다.
    const dex = await app.authed(token).get("/api/game/pokedex");
    const dexBody = dex.body as { caught: string[] };
    expect(dexBody.caught).toContain("charmeleon");
  });

  it("returns 400 for an ineligible/unknown branchId (condition not met)", async () => {
    const { token, uid } = await giveEligibleCharmander();

    const res = await app.authed(token).post(`/api/game/pokemon/${uid}/evolve`, {
      branchId: "not-a-real-branch",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when branchId is missing", async () => {
    const { token, uid } = await giveEligibleCharmander();

    const res = await app.authed(token).post(`/api/game/pokemon/${uid}/evolve`, {});
    expect(res.status).toBe(400);
  });
});
