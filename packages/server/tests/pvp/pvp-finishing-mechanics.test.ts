import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import { applyPowerMod, tryBeforeMove, type MoveContext } from "../../src/pvp/pvp-moves.js";
import type { MoveData } from "../../../../shared/types.js";
import type { PvpPokemon, PvpPlayerState, PvpRoomState } from "../../../../shared/pvp-types.js";

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
    ...overrides,
  };
}

function readyRoom(pokeA: PvpPokemon, pokeB: PvpPokemon) {
  const room = createRoom(
    "userA", "A", [pokeA, makePokemon("charizard")],
    "userB", "B", [pokeB, makePokemon("squirtle")],
  );
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);
  return room;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Task 1: Corrosion ────────────────────────────────────────

describe("Corrosion ability", () => {
  it("poison moves are blocked vs Steel/Poison types by default", () => {
    // A uses Toxic on a Steel type (magnemite = electric/steel)
    const pA = makePokemon("pikachu", {
      moves: [{ id: "toxic", pp: 10, maxPp: 10 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 120 },
    });
    const pB = makePokemon("magnemite", {
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
    });
    const room = readyRoom(pA, pB);
    vi.spyOn(Math, "random").mockReturnValue(0);
    submitAction(room, "userA", { type: "fight", moveId: "toxic" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(pB.statusCondition).toBeFalsy();
    expect(room.log.some((l) => l.includes("독이 통하지 않았다"))).toBe(true);
  });

  it("corrosion allows poisoning a Steel-type target", () => {
    // A has corrosion and uses Toxic on a Steel type
    const pA = makePokemon("salandit", {
      abilityId: "corrosion",
      moves: [{ id: "toxic", pp: 10, maxPp: 10 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 120 },
    });
    const pB = makePokemon("magnemite", {
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
    });
    const room = readyRoom(pA, pB);
    vi.spyOn(Math, "random").mockReturnValue(0);
    submitAction(room, "userA", { type: "fight", moveId: "toxic" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(pB.statusCondition).toBe("poison");
  });

  it("corrosion allows poisoning a Poison-type target", () => {
    const pA = makePokemon("salandit", {
      abilityId: "corrosion",
      moves: [{ id: "toxic", pp: 10, maxPp: 10 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 120 },
    });
    const pB = makePokemon("grimer", {
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
    });
    const room = readyRoom(pA, pB);
    vi.spyOn(Math, "random").mockReturnValue(0);
    submitAction(room, "userA", { type: "fight", moveId: "toxic" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(pB.statusCondition).toBe("poison");
  });
});

// ── Task 3: Binding Band / Grip Claw ─────────────────────────

describe("Binding Band", () => {
  it("trap damage rises from 1/8 to 1/6 when the attacker holds binding-band", () => {
    // A uses Wrap (a trap move) holding binding-band; measure damage per EOT.
    const pA = makePokemon("arbok", {
      heldItem: "binding-band",
      moves: [{ id: "wrap", pp: 20, maxPp: 20 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 120 },
    });
    const pB = makePokemon("eevee", {
      hp: 240, maxHp: 240,
      moves: [{ id: "splash", pp: 40, maxPp: 40 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 30 },
    });
    const room = readyRoom(pA, pB);
    // Make wrap hit, damage minimal, and trap applied.
    vi.spyOn(Math, "random").mockReturnValue(0);
    submitAction(room, "userA", { type: "fight", moveId: "wrap" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    // binding-band should set trapDamageBoost = true on the defender.
    expect(room.playerB.trapDamageBoost).toBe(true);
    // Expect the "바인드밴드" log message to appear.
    expect(room.log.some((l) => l.includes("바인드밴드"))).toBe(true);
  });
});

describe("Grip Claw", () => {
  it("grip-claw fixes trap duration to 7 turns", () => {
    const pA = makePokemon("arbok", {
      heldItem: "grip-claw",
      moves: [{ id: "wrap", pp: 20, maxPp: 20 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 120 },
    });
    const pB = makePokemon("eevee", {
      hp: 240, maxHp: 240,
      moves: [{ id: "splash", pp: 40, maxPp: 40 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 30 },
    });
    const room = readyRoom(pA, pB);
    vi.spyOn(Math, "random").mockReturnValue(0);
    submitAction(room, "userA", { type: "fight", moveId: "wrap" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });

    const trap = room.playerB.volatiles.find((v) => v.id === "trap");
    expect(trap).toBeDefined();
    // After the turn ends, one tick has already been consumed, so turnsRemaining
    // should be 6 (started at 7, ticked once in EOT).
    expect(trap?.turnsRemaining).toBe(6);
  });
});

// ── Task 4: Metronome item consecutive boost ─────────────────

describe("Metronome item", () => {
  it("consecutive use of the same move increments metronomeCount", () => {
    const pA = makePokemon("pikachu", {
      heldItem: "metronome",
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 120 },
    });
    const pB = makePokemon("eevee", {
      hp: 500, maxHp: 500,
      moves: [{ id: "splash", pp: 40, maxPp: 40 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 30 },
    });
    const room = readyRoom(pA, pB);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(room.playerA.metronomeCount ?? 0).toBe(0);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });
    // After first use, lastMoveUsed was undefined -> count stays 0
    expect(room.playerA.metronomeCount ?? 0).toBe(0);

    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });
    // Second consecutive use -> count = 1
    expect(room.playerA.metronomeCount).toBe(1);

    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });
    expect(room.playerA.metronomeCount).toBe(2);
  });

  it("using a different move resets metronomeCount to 0", () => {
    const pA = makePokemon("pikachu", {
      heldItem: "metronome",
      moves: [
        { id: "tackle", pp: 35, maxPp: 35 },
        { id: "scratch", pp: 35, maxPp: 35 },
      ],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 120 },
    });
    const pB = makePokemon("eevee", {
      hp: 500, maxHp: 500,
      moves: [{ id: "splash", pp: 40, maxPp: 40 }],
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 30 },
    });
    const room = readyRoom(pA, pB);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });
    expect(room.playerA.metronomeCount).toBe(1);

    submitAction(room, "userA", { type: "fight", moveId: "scratch" });
    submitAction(room, "userB", { type: "fight", moveId: "splash" });
    expect(room.playerA.metronomeCount).toBe(0);
  });
});

// ── Task 5: Avalanche / Revenge ──────────────────────────────

describe("Avalanche / Revenge", () => {
  function makeCtx(moveId: string, attackerHit: boolean): MoveContext {
    const atkPoke = makePokemon("pikachu");
    const defPoke = makePokemon("eevee");
    const attacker: PvpPlayerState = {
      userId: "a",
      nickname: "A",
      party: [atkPoke],
      activeIndex: 0,
      statStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
      volatiles: [],
      ready: true,
      actionSubmitted: false,
      wasHitThisTurn: attackerHit,
    };
    const defender: PvpPlayerState = {
      userId: "b",
      nickname: "B",
      party: [defPoke],
      activeIndex: 0,
      statStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
      volatiles: [],
      ready: true,
      actionSubmitted: false,
    };
    const move: MoveData = {
      id: moveId, name: moveId, type: "normal", category: "physical",
      power: 60, accuracy: 100, pp: 10, description: "",
    };
    const room: PvpRoomState = {
      roomId: "r", turn: 1, phase: "action",
      playerA: attacker, playerB: defender,
      turnDeadline: null, log: [], isAiBattle: false,
    };
    return { room, attacker, defender, atkPoke, defPoke, move, moveId };
  }

  it("avalanche doubles power when attacker took damage this turn", () => {
    const ctx = makeCtx("avalanche", true);
    expect(applyPowerMod(ctx)).toBe(120);
  });

  it("avalanche uses base power when attacker was not hit", () => {
    const ctx = makeCtx("avalanche", false);
    expect(applyPowerMod(ctx)).toBe(60);
  });

  it("revenge doubles power when attacker took damage this turn", () => {
    const ctx = makeCtx("revenge", true);
    expect(applyPowerMod(ctx)).toBe(120);
  });
});

// ── Task 6: Last Resort ──────────────────────────────────────

describe("Last Resort", () => {
  function makeCtx(moves: { id: string }[], movesUsed: string[]): MoveContext {
    const atkPoke = makePokemon("pikachu", {
      moves: moves.map((m) => ({ id: m.id, pp: 10, maxPp: 10 })),
    });
    const defPoke = makePokemon("eevee");
    const attacker: PvpPlayerState = {
      userId: "a",
      nickname: "A",
      party: [atkPoke],
      activeIndex: 0,
      statStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
      volatiles: [],
      ready: true,
      actionSubmitted: false,
      movesUsed,
    };
    const defender: PvpPlayerState = {
      userId: "b",
      nickname: "B",
      party: [defPoke],
      activeIndex: 0,
      statStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
      volatiles: [],
      ready: true,
      actionSubmitted: false,
    };
    const move: MoveData = {
      id: "last-resort", name: "last-resort", type: "normal", category: "physical",
      power: 140, accuracy: 100, pp: 5, description: "",
    };
    const room: PvpRoomState = {
      roomId: "r", turn: 1, phase: "action",
      playerA: attacker, playerB: defender,
      turnDeadline: null, log: [], isAiBattle: false,
    };
    return { room, attacker, defender, atkPoke, defPoke, move, moveId: "last-resort" };
  }

  it("fails when another move on the set has not been used", () => {
    const ctx = makeCtx(
      [{ id: "last-resort" }, { id: "tackle" }, { id: "scratch" }],
      ["tackle"], // scratch never used
    );
    const gate = tryBeforeMove(ctx);
    expect(gate?.cancel).toBe(true);
  });

  it("succeeds when every other move has been used at least once", () => {
    const ctx = makeCtx(
      [{ id: "last-resort" }, { id: "tackle" }, { id: "scratch" }],
      ["tackle", "scratch"],
    );
    const gate = tryBeforeMove(ctx);
    expect(gate?.cancel).toBeFalsy();
  });

  it("fails when last-resort is the only move on the set", () => {
    const ctx = makeCtx([{ id: "last-resort" }], []);
    const gate = tryBeforeMove(ctx);
    expect(gate?.cancel).toBe(true);
  });
});
