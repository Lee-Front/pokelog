import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "../api/test-helpers.js";
import { getUser, saveUser } from "../../src/storage/user-store.js";
import { runAutoSearch } from "../../src/polling/auto-search-worker.js";

// 30분 자동 탐색 스윕(runAutoSearch)의 스윕 조건과 보관 규칙을 검증한다.
// 실제 유저 파일을 HTTP로 만들고(같은 프로세스·DATA_DIR), 관심종/토글을 API로 세팅한 뒤
// runAutoSearch를 직접 호출한다. 롤 결정론을 위해 관심종을 지역 전체로 넓혀 "첫 매치"가 사실상
// 확정되게 하고, 상한/no-op은 유저 상태를 직접 조작해 검증한다.

describe("runAutoSearch (자동 탐색 30분 스윕)", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  // 관심종을 kanto 전체로 등록하고 자동 탐색을 켠 유저를 만든다. 관심 풀 = 전체 출몰 풀이므로
  // 12롤 중 첫 마리가 반드시 관심종에 매치된다(결정론적으로 1마리가 보관된다).
  async function enabledUser() {
    const { token, userId } = await app.registerAndLogin();
    await app.authed(token).put("/api/game/region", { region: "kanto" });
    const interests = await app.authed(token).get("/api/game/interests");
    const region = (interests.body as { regionSpecies: string[] }).regionSpecies;
    await app.authed(token).put("/api/game/interests", { species: region });
    await app.authed(token).put("/api/game/auto-search", { enabled: true });
    return { token, userId };
  }

  it("자동 켜짐 + 관심종 있는 유저의 보관함에 관심종을 틱당 최대 1마리 보관한다", async () => {
    const { userId } = await enabledUser();

    await runAutoSearch();

    const after = (await getUser(userId))!;
    expect(after.storedEncounters).toHaveLength(1);
    const interests = after.interestSpecies ?? [];
    expect(interests).toContain(after.storedEncounters![0].pokemon.species);
    expect(after.storedEncounters![0].type).toBe("wild_encounter");

    // 한 번 더 틱하면 최대 1마리씩만 늘어난다.
    await runAutoSearch();
    expect((await getUser(userId))!.storedEncounters).toHaveLength(2);
  });

  it("자동 꺼짐이거나 관심종이 없으면 보관하지 않는다(no-op)", async () => {
    // 관심종은 있지만 토글 꺼짐
    const { token, userId } = await app.registerAndLogin();
    await app.authed(token).put("/api/game/region", { region: "kanto" });
    await app.authed(token).put("/api/game/interests", { species: ["abra"] });
    // auto-search는 켜지 않는다

    await runAutoSearch();
    expect((await getUser(userId))!.storedEncounters ?? []).toHaveLength(0);
  });

  it("보관함이 이미 상한(10)이면 더 이상 보관하지 않는다", async () => {
    const { userId } = await enabledUser();

    // 상한만큼 미리 채운다(더미 인카운터 10개).
    const user = (await getUser(userId))!;
    user.storedEncounters = Array.from({ length: 10 }, (_, i) => ({
      id: `pre-${i}`,
      type: "wild_encounter" as const,
      pokemon: { species: "abra", level: 5, hp: 1, maxHp: 1, stats: {} as never, moves: [] },
      createdAt: new Date().toISOString(),
    }));
    await saveUser(user);

    await runAutoSearch();

    const after = (await getUser(userId))!;
    expect(after.storedEncounters).toHaveLength(10);
    // 새로 추가된 게 없어야 한다(모두 pre- 접두 id 유지).
    expect(after.storedEncounters!.every((e) => e.id.startsWith("pre-"))).toBe(true);
  });
});
