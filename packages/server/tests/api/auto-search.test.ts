import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";
import { getUser, saveUser } from "../../src/storage/user-store.js";

// 자동 야생 탐색 API — 관심종 지역검증 / 자동토글 게이트 / 보관함 인카운터 전투 시작.
// (30분 워커 자체의 스윕 로직은 tests/polling/auto-search-worker.test.ts에서 검증한다.)

describe("자동 야생 탐색 API", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  // 지역을 kanto로 고정하면 abra는 출몰, baltoy(hoenn 전용)는 미출몰이다.
  async function kantoUser() {
    const { token, userId } = await app.registerAndLogin();
    const res = await app.authed(token).put("/api/game/region", { region: "kanto" });
    expect(res.status).toBe(200);
    return { token, userId };
  }

  it("GET /interests는 현재 지역 출몰 종 목록과 기본값을 내려준다", async () => {
    const { token } = await kantoUser();
    const res = await app.authed(token).get("/api/game/interests");
    expect(res.status).toBe(200);
    const body = res.body as {
      interestSpecies: string[];
      autoSearchEnabled: boolean;
      storedEncounters: unknown[];
      regionSpecies: string[];
    };
    expect(body.interestSpecies).toEqual([]);
    expect(body.autoSearchEnabled).toBe(false);
    expect(body.storedEncounters).toEqual([]);
    expect(body.regionSpecies).toContain("abra");
    expect(body.regionSpecies).not.toContain("baltoy");
  });

  it("PUT /interests는 현재 지역 출몰 종만 허용한다(미출몰 종은 400)", async () => {
    const { token } = await kantoUser();

    const ok = await app.authed(token).put("/api/game/interests", { species: ["abra", "abra", "pidgey"] });
    expect(ok.status).toBe(200);
    // 중복 제거
    expect((ok.body as { interestSpecies: string[] }).interestSpecies).toEqual(["abra", "pidgey"]);

    const bad = await app.authed(token).put("/api/game/interests", { species: ["abra", "baltoy"] });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("해당 지역에 출몰하지 않는 종");

    // 배열이 아니면 400
    const notArray = await app.authed(token).put("/api/game/interests", { species: "abra" });
    expect(notArray.status).toBe(400);
  });

  it("PUT /auto-search는 관심종이 없으면 켜지지 않는다(400)", async () => {
    const { token } = await kantoUser();

    const noInterests = await app.authed(token).put("/api/game/auto-search", { enabled: true });
    expect(noInterests.status).toBe(400);
    expect((noInterests.body as { error: string }).error).toBe("관심 포켓몬을 먼저 등록하세요");

    // 관심종 등록 후에는 켜진다
    await app.authed(token).put("/api/game/interests", { species: ["abra"] });
    const on = await app.authed(token).put("/api/game/auto-search", { enabled: true });
    expect(on.status).toBe(200);
    expect((on.body as { autoSearchEnabled: boolean }).autoSearchEnabled).toBe(true);

    // 끄는 것은 관심종 여부와 무관하게 항상 허용
    const off = await app.authed(token).put("/api/game/auto-search", { enabled: false });
    expect(off.status).toBe(200);
    expect((off.body as { autoSearchEnabled: boolean }).autoSearchEnabled).toBe(false);
  });

  it("POST /stored/:id/battle는 보관 인카운터를 pendingEvents로 옮기고 전투를 연다", async () => {
    const { token, userId } = await kantoUser();

    // 야생 롤로 이벤트 하나를 확보한 뒤, 스토어를 통해 storedEncounters로 옮긴다(pendingEvents는 비움)
    // — 테스트 앱은 같은 프로세스·같은 DATA_DIR이라 스토어 직접 조작이 HTTP 상태와 일치한다.
    const search = await app.authed(token).post("/api/game/wild/search");
    const events = (search.body as { events: { id: string }[] }).events;
    const moved = events[0];

    const seedUser = (await getUser(userId))!;
    seedUser.storedEncounters = seedUser.pendingEvents.filter((e) => e.id === moved.id);
    seedUser.pendingEvents = [];
    await saveUser(seedUser);

    // 파티 리드 uid 확보
    const partyRes = await app.authed(token).get("/api/game/party");
    const lead = (partyRes.body as { party: { uid: string }[] }).party[0];

    const battle = await app.authed(token).post(`/api/game/stored/${moved.id}/battle`, {
      pokemonUid: lead.uid,
    });
    expect(battle.status).toBe(200);
    const body = battle.body as { battleState: { eventId: string; wild: { species: string } } };
    expect(body.battleState.eventId).toBe(moved.id);
    expect(body.battleState.wild.species).toBeTruthy();

    // 보관함에서 제거되었는지 확인
    const interests = await app.authed(token).get("/api/game/interests");
    expect((interests.body as { storedEncounters: unknown[] }).storedEncounters).toEqual([]);
  });

  it("POST /stored/:id/battle는 없는 id면 404", async () => {
    const { token } = await kantoUser();
    const partyRes = await app.authed(token).get("/api/game/party");
    const lead = (partyRes.body as { party: { uid: string }[] }).party[0];
    const res = await app.authed(token).post("/api/game/stored/nope/battle", { pokemonUid: lead.uid });
    expect(res.status).toBe(404);
  });
});
