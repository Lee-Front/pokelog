import { describe, it, expect } from "vitest";
import {
  register,
  getMoveEffects,
  hasFlag,
  getFlag,
  isContact,
  isSound,
  isOHKO,
  tryCustomResolve,
  tryBeforeMove,
  applyPowerMod,
  tryFixedDamage,
  triggerOnHit,
  triggerOnMiss,
  triggerApplyEffect,
  triggerHeal,
  type MoveContext,
  type MoveEffects,
} from "../../src/pvp/pvp-moves.js";
import type { MoveData } from "../../../../shared/types.js";
import type { PvpPlayerState, PvpPokemon, PvpRoomState } from "../../../../shared/pvp-types.js";

// ── Test fixtures ──
// Use unique move IDs per test to avoid registry cross-contamination.

function makeMove(id: string, overrides: Partial<MoveData> = {}): MoveData {
  return {
    id,
    name: id,
    type: "normal",
    category: "physical",
    power: 50,
    accuracy: 100,
    pp: 20,
    description: "",
    ...overrides,
  };
}

function makePokemon(species: string): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
  };
}

function makePlayer(userId: string, nickname: string, pokemon: PvpPokemon): PvpPlayerState {
  return {
    userId,
    nickname,
    party: [pokemon],
    activeIndex: 0,
    statStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    volatiles: [],
    ready: true,
    actionSubmitted: false,
  };
}

function makeRoom(): PvpRoomState {
  const playerA = makePlayer("userA", "A", makePokemon("pikachu"));
  const playerB = makePlayer("userB", "B", makePokemon("bulbasaur"));
  return {
    roomId: "test-room",
    turn: 1,
    phase: "action",
    playerA,
    playerB,
    turnDeadline: null,
    log: [],
    isAiBattle: false,
  };
}

function makeCtx(moveId: string, moveOverrides: Partial<MoveData> = {}): MoveContext {
  const room = makeRoom();
  return {
    room,
    attacker: room.playerA,
    defender: room.playerB,
    atkPoke: room.playerA.party[0],
    defPoke: room.playerB.party[0],
    move: makeMove(moveId, moveOverrides),
    moveId,
  };
}

// ── Tests ──

describe("pvp-moves registry", () => {
  it("register + getMoveEffects round-trip", () => {
    const effects: MoveEffects = { flags: { contact: true } };
    register("test-roundtrip", effects);
    expect(getMoveEffects("test-roundtrip")).toBe(effects);
  });

  it("empty registry returns undefined for unknown moves", () => {
    expect(getMoveEffects("this-move-is-never-registered-xyz")).toBeUndefined();
  });

  it("hasFlag returns false for unknown moves", () => {
    expect(hasFlag("this-move-is-never-registered-xyz", "contact")).toBe(false);
  });

  it("hasFlag returns false when the flag is not set", () => {
    register("test-noflags", {});
    expect(hasFlag("test-noflags", "contact")).toBe(false);
    expect(hasFlag("test-noflags", "sound")).toBe(false);
  });

  it("hasFlag and getFlag work for boolean flags", () => {
    register("test-boolflags", {
      flags: { contact: true, sound: true, isOHKO: true },
    });
    expect(hasFlag("test-boolflags", "contact")).toBe(true);
    expect(hasFlag("test-boolflags", "sound")).toBe(true);
    expect(hasFlag("test-boolflags", "isOHKO")).toBe(true);
    expect(hasFlag("test-boolflags", "powder")).toBe(false);
    expect(getFlag("test-boolflags", "contact")).toBe(true);
    expect(getFlag("test-boolflags", "powder")).toBeUndefined();
  });

  it("getFlag returns the raw string value for string-valued flags", () => {
    register("test-stringflags", {
      flags: { setsHazard: "spikes", setsWeather: "sun", forcesSwitch: "target" },
    });
    expect(getFlag("test-stringflags", "setsHazard")).toBe("spikes");
    expect(getFlag("test-stringflags", "setsWeather")).toBe("sun");
    expect(getFlag("test-stringflags", "forcesSwitch")).toBe("target");
  });

  it("convenience getters delegate to hasFlag", () => {
    register("test-convenience", {
      flags: { contact: true, sound: true, isOHKO: true },
    });
    expect(isContact("test-convenience")).toBe(true);
    expect(isSound("test-convenience")).toBe(true);
    expect(isOHKO("test-convenience")).toBe(true);

    register("test-convenience-empty", {});
    expect(isContact("test-convenience-empty")).toBe(false);
    expect(isSound("test-convenience-empty")).toBe(false);
    expect(isOHKO("test-convenience-empty")).toBe(false);
  });

  it("multiple registrations don't conflict", () => {
    register("test-multi-a", { flags: { contact: true } });
    register("test-multi-b", { flags: { sound: true } });
    register("test-multi-c", { flags: { punch: true, bite: true } });

    expect(hasFlag("test-multi-a", "contact")).toBe(true);
    expect(hasFlag("test-multi-a", "sound")).toBe(false);
    expect(hasFlag("test-multi-b", "sound")).toBe(true);
    expect(hasFlag("test-multi-b", "contact")).toBe(false);
    expect(hasFlag("test-multi-c", "punch")).toBe(true);
    expect(hasFlag("test-multi-c", "bite")).toBe(true);
    expect(hasFlag("test-multi-c", "contact")).toBe(false);
  });

  it("re-registering overwrites prior effects for the same move", () => {
    register("test-overwrite", { flags: { contact: true } });
    expect(hasFlag("test-overwrite", "contact")).toBe(true);
    register("test-overwrite", { flags: { sound: true } });
    expect(hasFlag("test-overwrite", "contact")).toBe(false);
    expect(hasFlag("test-overwrite", "sound")).toBe(true);
  });
});

describe("pvp-moves executor helpers", () => {
  it("tryCustomResolve returns false for unregistered moves", () => {
    const ctx = makeCtx("test-unregistered-custom");
    expect(tryCustomResolve(ctx)).toBe(false);
  });

  it("tryCustomResolve invokes the hook and returns its result", () => {
    let called = false;
    register("test-custom-resolve", {
      customResolve: () => { called = true; return true; },
    });
    const ctx = makeCtx("test-custom-resolve");
    expect(tryCustomResolve(ctx)).toBe(true);
    expect(called).toBe(true);
  });

  it("tryBeforeMove returns undefined when not registered", () => {
    expect(tryBeforeMove(makeCtx("test-unregistered-before"))).toBeUndefined();
  });

  it("tryBeforeMove forwards cancel/message from the hook", () => {
    register("test-before", {
      beforeMove: () => ({ cancel: true, message: "blocked" }),
    });
    const result = tryBeforeMove(makeCtx("test-before"));
    expect(result).toEqual({ cancel: true, message: "blocked" });
  });

  it("applyPowerMod returns base move power when no hook is registered", () => {
    const ctx = makeCtx("test-unregistered-power", { power: 77 });
    expect(applyPowerMod(ctx)).toBe(77);
  });

  it("applyPowerMod uses the registered modifier", () => {
    register("test-power", { modifyPower: () => 123 });
    const ctx = makeCtx("test-power", { power: 50 });
    expect(applyPowerMod(ctx)).toBe(123);
  });

  it("tryFixedDamage returns null when no hook is registered", () => {
    expect(tryFixedDamage(makeCtx("test-unregistered-fixed"))).toBeNull();
  });

  it("tryFixedDamage returns the hook's damage value", () => {
    register("test-fixed", { fixedDamage: () => 40 });
    expect(tryFixedDamage(makeCtx("test-fixed"))).toBe(40);
  });

  it("trigger hooks (onHit / onMiss / applyEffect / heal) are invoked when registered", () => {
    const calls: string[] = [];
    register("test-triggers", {
      onHit: () => { calls.push("hit"); },
      onMiss: () => { calls.push("miss"); },
      applyEffect: () => { calls.push("effect"); },
      heal: () => { calls.push("heal"); },
    });
    const ctx = makeCtx("test-triggers");
    triggerOnHit(ctx);
    triggerOnMiss(ctx);
    triggerApplyEffect(ctx);
    triggerHeal(ctx);
    expect(calls).toEqual(["hit", "miss", "effect", "heal"]);
  });

  it("trigger hooks are no-ops when the move has no such hook", () => {
    register("test-no-triggers", {});
    const ctx = makeCtx("test-no-triggers");
    expect(() => {
      triggerOnHit(ctx);
      triggerOnMiss(ctx);
      triggerApplyEffect(ctx);
      triggerHeal(ctx);
    }).not.toThrow();
  });
});
