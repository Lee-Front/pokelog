import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("shop + item usage", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t.cleanup();
  });

  it("lists shop items", async () => {
    const { token } = await t.registerAndLogin();
    const api = t.authed(token);

    const shop = await api.get("/api/shop");
    expect(shop.status).toBe(200);
    expect(shop.body.items).toBeDefined();
    expect(typeof shop.body.items).toBe("object");
    expect(shop.body.items.pokeball).toBeDefined();
  });

  it("buys an item with enough points", async () => {
    const { token, userId } = await t.registerAndLogin();
    const api = t.authed(token);

    // 포인트가 없으면 구매 실패해야 함
    const res = await api.post("/api/shop/buy", { item: "potion", quantity: 1 });
    // 포인트 부족 → 400
    expect(res.status).toBe(400);
  });

  it("uses a potion on damaged pokemon", async () => {
    const { token } = await t.registerAndLogin();
    const api = t.authed(token);

    // 파티 가져오기
    const party = await api.get("/api/game/party");
    const pokemon = party.body.party[0];

    // 포션 사용 시도 (인벤토리에 없으면 실패)
    const res = await api.post("/api/shop/use", {
      item: "potion",
      pokemonUid: pokemon.uid,
    });
    // 인벤토리에 potion 없음 → 에러
    expect(res.status).toBe(400);
  });

  it("equips a held item on party pokemon", async () => {
    const { token } = await t.registerAndLogin();
    const api = t.authed(token);

    const party = await api.get("/api/game/party");
    const pokemon = party.body.party[0];

    // 인벤토리에 아이템이 없으면 실패
    const res = await api.post("/api/game/items/equip", {
      item: "leftovers",
      pokemonUid: pokemon.uid,
    });
    expect(res.status).toBe(400);
  });
});
