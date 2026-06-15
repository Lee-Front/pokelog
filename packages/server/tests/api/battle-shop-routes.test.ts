import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("battle shop routes", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("GET / returns the battle shop catalog and the user's battle money", async () => {
    const { token } = await t.registerAndLogin("bshopper", "charmander");
    const res = await t.authed(token).get("/api/battle-shop/");

    expect(res.status).toBe(200);
    expect(res.body.battleMoney).toBe(0); // fresh user
    expect(res.body.items).toHaveProperty("super-potion");
    expect(res.body.items["super-potion"].price).toBeGreaterThan(0);
  });

  it("rejects a purchase when the user lacks battle money", async () => {
    const { token } = await t.registerAndLogin("brokeBshopper", "squirtle");
    const res = await t.authed(token).post("/api/battle-shop/buy", {
      item: "super-potion",
      quantity: 1,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/battle money/i);
  });

  it("rejects an unknown item", async () => {
    const { token } = await t.registerAndLogin("badItemBshopper", "bulbasaur");
    const res = await t.authed(token).post("/api/battle-shop/buy", {
      item: "not-a-real-item",
      quantity: 1,
    });

    expect(res.status).toBe(404);
  });

  it("rejects a non-positive quantity", async () => {
    const { token } = await t.registerAndLogin("zeroQtyBshopper", "squirtle");
    const res = await t.authed(token).post("/api/battle-shop/buy", {
      item: "super-potion",
      quantity: 0,
    });

    expect(res.status).toBe(400);
  });

  it("completes a purchase, deducting battle money and adding the item", async () => {
    const { token, userId } = await t.registerAndLogin("richBshopper", "charmander");

    // Grant battle money directly via the storage layer.
    const { getUser, saveUser } = await import("../../src/storage/user-store.js");
    const user = await getUser(userId);
    user!.battleMoney = 100;
    await saveUser(user!);

    const res = await t.authed(token).post("/api/battle-shop/buy", {
      item: "super-potion", // price 30
      quantity: 2,
    });

    expect(res.status).toBe(200);
    expect(res.body.battleMoney).toBe(100 - 30 * 2);
    expect(res.body.inventory["super-potion"]).toBe(2);
  });

  it("defaults to a single item when quantity is omitted", async () => {
    const { token, userId } = await t.registerAndLogin("defaultQtyBshopper", "bulbasaur");

    const { getUser, saveUser } = await import("../../src/storage/user-store.js");
    const user = await getUser(userId);
    user!.battleMoney = 100;
    await saveUser(user!);

    const res = await t.authed(token).post("/api/battle-shop/buy", { item: "super-potion" });

    expect(res.status).toBe(200);
    expect(res.body.battleMoney).toBe(100 - 30);
    expect(res.body.inventory["super-potion"]).toBe(1);
  });

  it("rejects a purchase that the user cannot fully afford", async () => {
    const { token, userId } = await t.registerAndLogin("poorBshopper", "charmander");

    const { getUser, saveUser } = await import("../../src/storage/user-store.js");
    const user = await getUser(userId);
    user!.battleMoney = 50; // enough for 1 super-potion (30) but not 2
    await saveUser(user!);

    const res = await t.authed(token).post("/api/battle-shop/buy", {
      item: "super-potion",
      quantity: 2,
    });

    expect(res.status).toBe(400);
  });

  it("rejects quantity above the 99 cap", async () => {
    const { token, userId } = await t.registerAndLogin("capBshopper", "squirtle");

    const { getUser, saveUser } = await import("../../src/storage/user-store.js");
    const user = await getUser(userId);
    user!.battleMoney = 1000000;
    await saveUser(user!);

    const res = await t.authed(token).post("/api/battle-shop/buy", {
      item: "super-potion",
      quantity: 100,
    });

    expect(res.status).toBe(400);
  });
});
