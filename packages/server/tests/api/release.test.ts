import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

// POST /game/pokemon/:uid/release — 포켓몬 풀어주기

describe("POST /api/game/pokemon/:uid/release", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  // 풀어줄 포켓몬 uid를 admin으로 추가하고 그 uid를 반환.
  async function givePokemon(userId: string, species = "pidgey"): Promise<string> {
    const res = await app.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species,
      level: 5,
    });
    expect(res.status).toBe(200);
    return (res.body as { pokemon: { uid: string } }).pokemon.uid;
  }

  it("파티에 2마리+ 면 한 마리를 풀어줄 수 있다", async () => {
    const { token, userId } = await app.registerAndLogin();
    const uid = await givePokemon(userId); // 스타터 + 1 → 파티 2

    const res = await app.authed(token).post(`/api/game/pokemon/${uid}/release`);
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);

    // 상세 조회가 404 → 실제로 제거됨
    const detail = await app.authed(token).get(`/api/game/pokemon/${uid}`);
    expect(detail.status).toBe(404);
  });

  it("파티 마지막 1마리는 풀어줄 수 없다(전멸 방지)", async () => {
    const { token } = await app.registerAndLogin();
    // 신규 유저는 스타터 1마리뿐. 그 uid를 파티에서 가져온다.
    const party = await app.authed(token).get("/api/game/party");
    const starterUid = (party.body as { party: { uid: string }[] }).party[0].uid;

    const res = await app.authed(token).post(`/api/game/pokemon/${starterUid}/release`);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("마지막");

    // 여전히 존재
    const detail = await app.authed(token).get(`/api/game/pokemon/${starterUid}`);
    expect(detail.status).toBe(200);
  });

  it("보관함 포켓몬은 파티 크기와 무관하게 풀어줄 수 있다", async () => {
    const { token, userId } = await app.registerAndLogin();
    const uid = await givePokemon(userId); // 파티 2마리
    // 보관함으로 맡긴다(파티 1마리 남음, deposit 허용)
    const dep = await app.authed(token).post("/api/game/storage/deposit", { uid });
    expect(dep.status).toBe(200);

    const res = await app.authed(token).post(`/api/game/pokemon/${uid}/release`);
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);

    const detail = await app.authed(token).get(`/api/game/pokemon/${uid}`);
    expect(detail.status).toBe(404);
  });

  it("없는 uid는 404", async () => {
    const { token } = await app.registerAndLogin();
    const res = await app.authed(token).post("/api/game/pokemon/does-not-exist/release");
    expect(res.status).toBe(404);
  });
});

// POST /game/pokemon/release-many — 여러 마리 한번에 풀어주기
describe("POST /api/game/pokemon/release-many", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  async function givePokemon(userId: string, species = "pidgey"): Promise<string> {
    const res = await app.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species,
      level: 5,
    });
    expect(res.status).toBe(200);
    return (res.body as { pokemon: { uid: string } }).pokemon.uid;
  }

  it("보관함 여러 마리를 한번에 풀어준다", async () => {
    const { token, userId } = await app.registerAndLogin();
    const a = await givePokemon(userId);
    const b = await givePokemon(userId);
    // 둘 다 보관함으로(파티는 스타터 1마리만 남김).
    await app.authed(token).post("/api/game/storage/deposit", { uid: a });
    await app.authed(token).post("/api/game/storage/deposit", { uid: b });

    const res = await app.authed(token).post("/api/game/pokemon/release-many", { uids: [a, b] });
    expect(res.status).toBe(200);
    expect((res.body as { released: string[] }).released.sort()).toEqual([a, b].sort());

    expect((await app.authed(token).get(`/api/game/pokemon/${a}`)).status).toBe(404);
    expect((await app.authed(token).get(`/api/game/pokemon/${b}`)).status).toBe(404);
  });

  it("파티 포함 선택도 남는 파티가 1마리 이상이면 허용된다", async () => {
    const { token, userId } = await app.registerAndLogin();
    const a = await givePokemon(userId); // 파티 2마리(스타터 + a)

    const res = await app.authed(token).post("/api/game/pokemon/release-many", { uids: [a] });
    expect(res.status).toBe(200);

    const party = await app.authed(token).get("/api/game/party");
    expect((party.body as { party: { uid: string }[] }).party).toHaveLength(1);
  });

  it("배치 결과로 파티가 0마리가 되면 전부 거부한다(부분 실행 없음)", async () => {
    const { token } = await app.registerAndLogin();
    const party = await app.authed(token).get("/api/game/party");
    const starterUid = (party.body as { party: { uid: string }[] }).party[0].uid;

    const res = await app
      .authed(token)
      .post("/api/game/pokemon/release-many", { uids: [starterUid] });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("최소 1마리");

    // 거부됐으니 여전히 존재해야 한다.
    const detail = await app.authed(token).get(`/api/game/pokemon/${starterUid}`);
    expect(detail.status).toBe(200);
  });

  it("존재하지 않는 uid가 하나라도 섞이면 유효한 것도 전부 거부한다", async () => {
    const { token, userId } = await app.registerAndLogin();
    const a = await givePokemon(userId);
    await app.authed(token).post("/api/game/storage/deposit", { uid: a });

    const res = await app
      .authed(token)
      .post("/api/game/pokemon/release-many", { uids: [a, "does-not-exist"] });
    expect(res.status).toBe(404);

    // a는 여전히 존재(부분 실행 안 됨).
    expect((await app.authed(token).get(`/api/game/pokemon/${a}`)).status).toBe(200);
  });

  it("빈 배열이나 배열이 아닌 값은 400", async () => {
    const { token } = await app.registerAndLogin();
    const empty = await app.authed(token).post("/api/game/pokemon/release-many", { uids: [] });
    expect(empty.status).toBe(400);

    const notArray = await app
      .authed(token)
      .post("/api/game/pokemon/release-many", { uids: "not-an-array" });
    expect(notArray.status).toBe(400);
  });
});
