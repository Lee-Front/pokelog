/**
 * Regression tests for stat-change move targeting.
 *
 * Bug: pvp-turn-resolution.ts used a `category === "status" && statChance === 0`
 * heuristic to flag a stat change as self-targeting, which incorrectly routed
 * opponent-targeting status moves (sand-attack, growl, leer, tail-whip,
 * string-shot, smokescreen, …) into the self-target branch. The fix uses
 * only the move's `target` field: `user`, `users-field`, and
 * `user-and-allies` are the only self-targeting values.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makeMon(species: string, moves: string[], overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-${Math.random().toString(36).slice(2, 8)}`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 80 },
    moves: moves.map((id) => ({ id, pp: 24, maxPp: 24 })),
    statusCondition: null,
    abilityId: null,
    heldItem: null,
    teraType: null,
    originalTypes: ["normal"],
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

describe("Stat-change move targeting", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sand-attack lowers opponent's accuracy, not user's", () => {
    const me = makeMon("pikachu", ["sand-attack"]);
    const opp = makeMon("charizard", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "sand-attack" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerB.statStages.accuracy).toBe(-1);
    expect(room.playerA.statStages.accuracy).toBe(0);
  });

  it("growl lowers opponent's attack, not user's", () => {
    const me = makeMon("rattata", ["growl"]);
    const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "growl" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerB.statStages.attack).toBe(-1);
    expect(room.playerA.statStages.attack).toBe(0);
  });

  it("leer lowers opponent's defense", () => {
    const me = makeMon("ekans", ["leer"]);
    const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "leer" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerB.statStages.defense).toBe(-1);
    expect(room.playerA.statStages.defense).toBe(0);
  });

  it("tail-whip lowers opponent's defense", () => {
    const me = makeMon("rattata", ["tail-whip"]);
    const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "tail-whip" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerB.statStages.defense).toBe(-1);
    expect(room.playerA.statStages.defense).toBe(0);
  });

  it("string-shot lowers opponent's speed", () => {
    const me = makeMon("caterpie", ["string-shot"]);
    const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "string-shot" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerB.statStages.speed).toBe(-2);
    expect(room.playerA.statStages.speed).toBe(0);
  });

  it("smokescreen lowers opponent's accuracy", () => {
    const me = makeMon("koffing", ["smokescreen"]);
    const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "smokescreen" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerB.statStages.accuracy).toBe(-1);
    expect(room.playerA.statStages.accuracy).toBe(0);
  });

  it("swords-dance raises user's attack (regression: self-target still works)", () => {
    const me = makeMon("scyther", ["swords-dance"]);
    const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "swords-dance" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerA.statStages.attack).toBe(2);
    expect(room.playerB.statStages.attack).toBe(0);
  });

  it("calm-mind raises user's spAttack and spDefense (regression)", () => {
    const me = makeMon("alakazam", ["calm-mind"]);
    const opp = makeMon("snorlax", ["splash"], { hp: 400, maxHp: 400 });
    const room = createRoom("u1", "A", [me], "u2", "B", [opp], false);
    selectLead(room, "u1", 0);
    selectLead(room, "u2", 0);

    submitAction(room, "u1", { type: "fight", moveId: "calm-mind" });
    submitAction(room, "u2", { type: "fight", moveId: "splash" });

    expect(room.playerA.statStages.spAttack).toBe(1);
    expect(room.playerA.statStages.spDefense).toBe(1);
    expect(room.playerB.statStages.spAttack).toBe(0);
    expect(room.playerB.statStages.spDefense).toBe(0);
  });
});
