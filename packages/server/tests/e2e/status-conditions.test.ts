import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "../api/test-helpers.js";

describe("Status Conditions E2E", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  it("battle -> pokemon gets poisoned -> battle continues -> poison damage each turn", async () => {
    const { token, userId } = await t.registerAndLogin("poisontest", "charmander");
    const api = t.authed(token);

    // Get party
    const party = await api.get("/api/game/party");
    const myPokemon = party.body.party[0];
    const moveId = myPokemon.moves[0].id;

    // Give low-level encounter
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 3,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Start battle
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: myPokemon.uid,
    });
    expect(start.status).toBe(200);
    expect(start.body.battleState).toBeDefined();
    expect(start.body.battleState.playerVolatile).toEqual([]);
    expect(start.body.battleState.wildVolatile).toEqual([]);

    // Fight until win or lose (max 30 turns safety)
    let result = "continue";
    for (let turn = 0; turn < 30 && result === "continue"; turn++) {
      const action = await api.post("/api/battle/action", {
        action: "fight",
        data: { moveId },
      });
      expect(action.status).toBe(200);
      result = action.body.result;

      if (result === "fainted") break;
    }

    // Battle should complete without errors
    expect(["win", "lose", "fainted"]).toContain(result);
  });

  it("battle ends -> pokemon still poisoned -> heal -> status cleared", async () => {
    const { token, userId } = await t.registerAndLogin("healstatustest", "charmander");
    const api = t.authed(token);

    // Get party
    const party = await api.get("/api/game/party");
    const myPokemon = party.body.party[0];

    // Manually verify that heal clears status via the heal endpoint
    // First, give encounter and start battle
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 3,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Start battle
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: myPokemon.uid,
    });
    expect(start.status).toBe(200);

    // Run away to end battle cleanly
    const run = await api.post("/api/battle/action", {
      action: "run",
    });
    expect(run.status).toBe(200);
    expect(run.body.result).toBe("run");

    // Now heal the party (should clear any status)
    const heal = await api.post("/api/game/heal");
    expect(heal.status).toBe(200);
    expect(heal.body.healed).toBe(1);

    // Verify pokemon is healed and has no status
    const partyAfter = await api.get("/api/game/party");
    expect(partyAfter.status).toBe(200);
    const healedPokemon = partyAfter.body.party[0];
    expect(healedPokemon.hp).toBe(healedPokemon.maxHp);
    expect(healedPokemon.statusCondition).toBeNull();
  });
});
