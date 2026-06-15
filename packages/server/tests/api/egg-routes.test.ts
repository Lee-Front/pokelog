import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

// POST /game/eggs/buy(즉시부화), /game/eggs/pull, /game/eggs/hatch-all
// — 보관 폐지 즉시부화 + 파티 풀이면 보관함(toBox) 처리 검증.

describe("egg routes — 즉시부화 + toBox", () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await setupTestApp();
  });

  afterAll(() => {
    app.cleanup();
  });

  // 즉시부화에 충분한 포인트를 지급한다.
  async function givePoints(userId: string, amount = 10000): Promise<void> {
    const res = await app.admin().post("/api/admin/test/give-points", { userId, amount });
    expect(res.status).toBe(200);
  }

  // 파티를 6마리로 가득 채운다(스타터 1 + 5마리 지급).
  async function fillParty(userId: string): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const res = await app.admin().post("/api/admin/test/give-pokemon", {
        userId,
        species: "pidgey",
        level: 5,
      });
      expect(res.status).toBe(200);
    }
  }

  it("buy는 알을 보관하지 않고 즉시 부화시켜 포켓몬을 반환한다", async () => {
    const { token, userId } = await app.registerAndLogin();
    await givePoints(userId);

    const res = await app.authed(token).post("/api/game/eggs/buy", { tier: "common" });
    expect(res.status).toBe(200);
    const body = res.body as {
      pokemon?: { uid: string; species: string };
      destination: string;
      toBox: boolean;
    };
    expect(body.pokemon?.uid).toBeTruthy();
    expect(body.destination).toBe("party");
    expect(body.toBox).toBe(false);

    // 보관 알이 생기지 않아야 한다.
    const overview = await app.authed(token).get("/api/game/eggs");
    expect((overview.body as { eggs: unknown[] }).eggs).toHaveLength(0);
  });

  it("파티가 꽉 차면 부화 포켓몬은 보관함으로 가고 toBox=true", async () => {
    const { token, userId } = await app.registerAndLogin();
    await givePoints(userId);
    await fillParty(userId);

    const res = await app.authed(token).post("/api/game/eggs/buy", { tier: "common" });
    expect(res.status).toBe(200);
    const body = res.body as { destination: string; toBox: boolean };
    expect(body.destination).toBe("storage");
    expect(body.toBox).toBe(true);
  });

  it("pull도 toBox 플래그를 반환한다", async () => {
    const { token, userId } = await app.registerAndLogin();
    await givePoints(userId);
    await fillParty(userId);

    const res = await app.authed(token).post("/api/game/eggs/pull", { tier: "common" });
    expect(res.status).toBe(200);
    const body = res.body as { destination: string; toBox: boolean };
    expect(body.destination).toBe("storage");
    expect(body.toBox).toBe(true);
  });

  it("hatch-all은 보관 알이 없으면 빈 결과를 반환한다", async () => {
    const { token } = await app.registerAndLogin();
    const res = await app.authed(token).post("/api/game/eggs/hatch-all");
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(0);
    expect((res.body as { hatched: unknown[] }).hatched).toHaveLength(0);
  });
});
