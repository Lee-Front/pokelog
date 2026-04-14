import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("shop + item usage", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("lists shop items", async () => {
    const { token } = await t.registerAndLogin();
    const api = t.authed(token);

    const shop = await api.get("/api/shop");
    expect(shop.status).toBe(200);
    expect(shop.body.items).toBeDefined();
    expect(typeof shop.body.items).toBe("object");
    expect(shop.body.items.pokeball).toBeDefined();
    expect(typeof shop.body.items.pokeball.price).toBe("number");
    expect(typeof shop.body.items.pokeball.name).toBe("string");
  });

  it("rejects purchase when user has insufficient points", async () => {
    const { token, userId } = await t.registerAndLogin();
    const api = t.authed(token);

    // 포인트가 없으면 구매 실패해야 함
    const res = await api.post("/api/shop/buy", { item: "potion", quantity: 1 });
    // 포인트 부족 → 400
    expect(res.status).toBe(400);
  });

  it("buys an item with sufficient points", async () => {
    const { token, userId } = await t.registerAndLogin();
    const api = t.authed(token);

    // Give the user enough points via admin API
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 10000 });

    const res = await api.post("/api/shop/buy", { item: "pokeball", quantity: 2 });
    expect(res.status).toBe(200);
    expect(typeof res.body.points).toBe("number");
    expect(res.body.points).toBeLessThan(10000);
    expect(res.body.inventory).toBeDefined();
    expect(typeof res.body.message).toBe("string");
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

  it("uses a potion successfully on a damaged pokemon", async () => {
    const { token, userId } = await t.registerAndLogin();
    const api = t.authed(token);

    // Give user enough points via admin API and buy a potion
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 10000 });

    const buy = await api.post("/api/shop/buy", { item: "potion", quantity: 1 });
    expect(buy.status).toBe(200);

    // Damage the pokemon by setting HP to 1 via file manipulation
    const partyRes = await api.get("/api/game/party");
    const pokemon = partyRes.body.party[0];

    const userFile = path.join(t.dataDir, "users", `${userId}.json`);
    const damagedData = JSON.parse(fs.readFileSync(userFile, "utf-8"));
    const pokemonInFile = damagedData.pokemon.find((p: { uid: string }) => p.uid === pokemon.uid);
    pokemonInFile.hp = 1;
    fs.writeFileSync(userFile, JSON.stringify(damagedData));

    // Use the potion
    const useRes = await api.post("/api/shop/use", {
      item: "potion",
      pokemonUid: pokemon.uid,
    });
    expect(useRes.status).toBe(200);
    expect(useRes.body.pokemon.hp).toBeGreaterThan(1);
  });

  it("equips a held item successfully", async () => {
    const { token, userId } = await t.registerAndLogin();
    const api = t.authed(token);

    // Get the party pokemon uid
    const partyRes = await api.get("/api/game/party");
    const pokemon = partyRes.body.party[0];

    // Add leftovers to inventory via admin API
    await t.admin().post("/api/admin/test/give-item", { userId, item: "leftovers", quantity: 1 });

    // Equip the held item
    const equipRes = await api.post("/api/game/items/equip", {
      item: "leftovers",
      pokemonUid: pokemon.uid,
    });
    expect(equipRes.status).toBe(200);
    expect(equipRes.body.pokemon.heldItem).toBe("leftovers");
  });
});
