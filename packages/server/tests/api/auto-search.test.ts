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

  it("GET /interests는 현재 지역 출몰 종 목록·기본값·지역키를 내려준다", async () => {
    const { token } = await kantoUser();
    const res = await app.authed(token).get("/api/game/interests");
    expect(res.status).toBe(200);
    const body = res.body as {
      interestSpecies: string[];
      autoSearchEnabled: boolean;
      storedEncounters: unknown[];
      regionSpecies: string[];
      region: string;
    };
    expect(body.interestSpecies).toEqual([]);
    expect(body.autoSearchEnabled).toBe(false);
    expect(body.storedEncounters).toEqual([]);
    expect(body.regionSpecies).toContain("abra");
    expect(body.regionSpecies).not.toContain("baltoy");
    expect(body.region).toBe("kanto");
  });

  it("PUT /interests는 현재 지역 출몰 종만 허용한다(미출몰 종은 400)", async () => {
    const { token } = await kantoUser();

    const ok = await app.authed(token).put("/api/game/interests", { species: ["abra", "abra", "pidgey"] });
    expect(ok.status).toBe(200);
    // 중복 제거 + 현재 지역키를 함께 내려준다
    expect((ok.body as { interestSpecies: string[]; region: string }).interestSpecies).toEqual(["abra", "pidgey"]);
    expect((ok.body as { region: string }).region).toBe("kanto");

    const bad = await app.authed(token).put("/api/game/interests", { species: ["abra", "baltoy"] });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("해당 지역에 출몰하지 않는 종");

    // 배열이 아니면 400
    const notArray = await app.authed(token).put("/api/game/interests", { species: "abra" });
    expect(notArray.status).toBe(400);
  });

  it("PUT /interests는 현재 지역에만 저장하고 다른 지역 관심종은 보존한다", async () => {
    const { token, userId } = await kantoUser();

    // kanto에 관심종을 등록한다.
    const kanto = await app.authed(token).put("/api/game/interests", { species: ["abra", "pidgey"] });
    expect(kanto.status).toBe(200);

    // hoenn으로 이동해 그 지역 관심종을 등록한다(baltoy는 hoenn 출몰).
    await app.authed(token).put("/api/game/region", { region: "hoenn" });
    const hoenn = await app.authed(token).put("/api/game/interests", { species: ["baltoy"] });
    expect(hoenn.status).toBe(200);
    expect((hoenn.body as { region: string }).region).toBe("hoenn");

    // hoenn에서 조회하면 hoenn 목록만 보인다.
    const hoennGet = await app.authed(token).get("/api/game/interests");
    expect((hoennGet.body as { interestSpecies: string[]; region: string }).interestSpecies).toEqual(["baltoy"]);
    expect((hoennGet.body as { region: string }).region).toBe("hoenn");

    // kanto로 돌아오면 kanto 목록이 그대로 보존돼 있다.
    await app.authed(token).put("/api/game/region", { region: "kanto" });
    const kantoGet = await app.authed(token).get("/api/game/interests");
    expect((kantoGet.body as { interestSpecies: string[] }).interestSpecies).toEqual(["abra", "pidgey"]);

    // 저장된 구조도 지역별 맵이다.
    const user = (await getUser(userId))!;
    expect(user.interestSpecies).toEqual({ kanto: ["abra", "pidgey"], hoenn: ["baltoy"] });
  });

  it("구버전 배열 관심종은 현재 지역 키로 이관된다(마이그레이션)", async () => {
    const { token, userId } = await kantoUser();

    // 구 저장본 형태(전역 배열)를 파일에 직접 심는다. saveUser의 normalize가 지역 맵으로 이관한다.
    const seed = (await getUser(userId))!;
    (seed as unknown as { interestSpecies: string[] }).interestSpecies = ["abra", "pidgey"];
    await saveUser(seed);

    // 저장된 구조가 { kanto: [...] } 로 이관돼 있다.
    const migrated = (await getUser(userId))!;
    expect(migrated.interestSpecies).toEqual({ kanto: ["abra", "pidgey"] });

    // GET도 현재 지역(kanto) 목록으로 그 값을 내려준다.
    const res = await app.authed(token).get("/api/game/interests");
    expect((res.body as { interestSpecies: string[] }).interestSpecies).toEqual(["abra", "pidgey"]);
  });

  it("PUT /auto-search는 관심종 요건 없이 on/off 된다", async () => {
    const { token } = await kantoUser();

    // 관심종이 없어도 켜진다(요건 가드 제거).
    const on = await app.authed(token).put("/api/game/auto-search", { enabled: true });
    expect(on.status).toBe(200);
    expect((on.body as { autoSearchEnabled: boolean }).autoSearchEnabled).toBe(true);

    // 끄는 것도 항상 허용.
    const off = await app.authed(token).put("/api/game/auto-search", { enabled: false });
    expect(off.status).toBe(200);
    expect((off.body as { autoSearchEnabled: boolean }).autoSearchEnabled).toBe(false);

    // boolean이 아니면 400.
    const bad = await app.authed(token).put("/api/game/auto-search", { enabled: "yes" });
    expect(bad.status).toBe(400);
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
