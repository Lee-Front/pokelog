/**
 * Scenario 8 — IV Hunter.
 *
 * Models the lifecycle of an IV-focused trainer:
 *  - Generate 10 freshly-rolled pikachu and call /api/user/judge/:uid
 *    on each — verifies the endpoint returns ivs, total and verdict
 *  - Find the highest-IV-total pikachu and apply 10 proteins via
 *    useInventoryItem; attack stat must rise; 11th protein rejected
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import { useInventoryItem } from "../../src/game/item-usage.js";
import { saveUser } from "../../src/storage/user-store.js";
import { getUserState } from "./test-helpers.js";

describe("Scenario 8 — IV Hunter", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("judges 10 pikachu and finds the highest-IV-total individual", async () => {
    const { user, token } = await createTestUser({
      uid: "ivHunter1",
      initialPokemon: Array.from({ length: 10 }, () => ({ species: "pikachu", level: 25 })),
    });
    const http = new HttpClient(ctx.app, token);

    let bestUid: string | null = null;
    let bestTotal = -1;
    for (const poke of user.pokemon) {
      const res = await http.get(`/api/user/judge/${poke.uid}`);
      expect(res.status).toBe(200);
      expect(res.body.legacy).toBe(false);
      expect(res.body.species).toBe("pikachu");
      expect(typeof res.body.total).toBe("number");
      expect(res.body.total).toBeGreaterThanOrEqual(0);
      expect(res.body.total).toBeLessThanOrEqual(186);
      if (res.body.total > bestTotal) {
        bestTotal = res.body.total;
        bestUid = poke.uid;
      }
    }
    expect(bestUid).not.toBeNull();
    expect(bestTotal).toBeGreaterThanOrEqual(0);
  });

  it("10 proteins boost attack stat; 11th protein is rejected", async () => {
    const { user } = await createTestUser({
      uid: "ivHunter2",
      initialPokemon: [{ species: "pikachu", level: 50 }],
    });
    const pika = user.pokemon[0];
    user.inventory["protein"] = 11;
    const initialAttack = pika.stats.attack;

    const proteinShopItem = {
      name: "단백질",
      price: 5000,
      vitaminStat: "attack" as const,
    };

    for (let i = 0; i < 10; i++) {
      const result = useInventoryItem(user, "protein", pika.uid, proteinShopItem);
      expect(result.kind).toBe("vitamin");
      expect(result.newVitaminCount).toBe(i + 1);
    }
    expect(pika.stats.attack).toBeGreaterThan(initialAttack);
    expect(pika.appliedVitamins?.attack).toBe(10);

    expect(() =>
      useInventoryItem(user, "protein", pika.uid, proteinShopItem),
    ).toThrowError(/영양제/);

    // Persist so a subsequent /profile call sees the same state.
    await saveUser(user);
  });
});
