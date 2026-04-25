/**
 * Scenario 9 — Crisis Management.
 *
 * Verifies decideBattleAction routes correctly through three pressure
 * levels:
 *  - HP > 30%, no items: pick an attack
 *  - HP < 30% with potion in inventory: use potion
 *  - HP < 15% with another alive party member: switch out
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { decideBattleAction, type BattleAiContext } from "./ai-player.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";

function buildCtx(overrides: Partial<BattleAiContext> = {}): BattleAiContext {
  const charizard = createPokemon("charizard", 50);
  return {
    myActivePoke: charizard,
    myParty: [charizard],
    oppActivePoke: { species: "rattata", hp: 50, maxHp: 100, types: ["normal"] },
    myItems: {},
    turn: 1,
    ...overrides,
  };
}

describe("Scenario 9 — Crisis Management", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("picks attack when HP is healthy", () => {
    const battleCtx = buildCtx();
    battleCtx.myActivePoke.hp = battleCtx.myActivePoke.maxHp;
    const decision = decideBattleAction(battleCtx);
    expect(decision.type).toBe("attack");
    expect(decision.moveId).toBeDefined();
  });

  it("uses potion when HP < 30% and a healing item is available", () => {
    const battleCtx = buildCtx();
    battleCtx.myActivePoke.hp = Math.floor(battleCtx.myActivePoke.maxHp * 0.2);
    battleCtx.myItems = { potion: 1 };
    const decision = decideBattleAction(battleCtx);
    expect(decision.type).toBe("item");
    expect(decision.itemId).toBe("potion");
  });

  it("switches to a healthy party member when HP is critical (<15%)", () => {
    const fresh = createPokemon("blastoise", 50);
    const battleCtx = buildCtx({
      myParty: [],
    });
    battleCtx.myParty = [battleCtx.myActivePoke, fresh];
    battleCtx.myActivePoke.hp = Math.floor(battleCtx.myActivePoke.maxHp * 0.1);
    // No healing items — switch is the rational fallback.
    const decision = decideBattleAction(battleCtx);
    expect(decision.type).toBe("switch");
    expect(decision.pokemonUid).toBe(fresh.uid);
  });

  it("falls back to attack when low HP but no items and no alive switch target", () => {
    const battleCtx = buildCtx();
    battleCtx.myActivePoke.hp = Math.floor(battleCtx.myActivePoke.maxHp * 0.1);
    const decision = decideBattleAction(battleCtx);
    expect(decision.type).toBe("attack");
  });
});
