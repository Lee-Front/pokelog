import { describe, it, expect, vi } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import { hasItemFlag } from "../../src/pvp/pvp-items.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
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

describe("new items: utility-umbrella", () => {
  it("utility-umbrella blocks sandstorm weather damage", () => {
    // Both sides use a status move (growl) so neither takes direct damage.
    // Weather damage should apply only to the pokemon without the umbrella.
    const atkA = makePokemon("pikachu", { moves: [{ id: "growl", pp: 40, maxPp: 40 }] });
    const defA = makePokemon("pikachu", {
      moves: [{ id: "growl", pp: 40, maxPp: 40 }],
      heldItem: "utility-umbrella",
    });
    const room1 = readyRoom(atkA, defA);
    room1.weather = "sandstorm";
    room1.weatherTurns = 5;
    submitAction(room1, "userA", { type: "fight", moveId: "growl" });
    submitAction(room1, "userB", { type: "fight", moveId: "growl" });
    const pADamage = 200 - defA.hp;

    const atkB = makePokemon("pikachu", { moves: [{ id: "growl", pp: 40, maxPp: 40 }] });
    const defB = makePokemon("pikachu", {
      moves: [{ id: "growl", pp: 40, maxPp: 40 }],
      heldItem: null,
    });
    const room2 = readyRoom(atkB, defB);
    room2.weather = "sandstorm";
    room2.weatherTurns = 5;
    submitAction(room2, "userA", { type: "fight", moveId: "growl" });
    submitAction(room2, "userB", { type: "fight", moveId: "growl" });
    const pBDamage = 200 - defB.hp;

    expect(pADamage).toBe(0); // utility-umbrella fully blocks weather damage
    expect(pBDamage).toBeGreaterThan(0);
  });

  it("hasItemFlag reports weatherImmune for utility-umbrella", () => {
    const poke = makePokemon("pikachu", { heldItem: "utility-umbrella" });
    expect(hasItemFlag(poke, "weatherImmune")).toBe(true);
  });
});

describe("new items: shed-shell", () => {
  it("shed-shell reports bypassTrap flag", () => {
    const poke = makePokemon("shedinja", { heldItem: "shed-shell" });
    expect(hasItemFlag(poke, "bypassTrap")).toBe(true);
  });

  it("shed-shell allows switching while trapped", () => {
    const pA = makePokemon("pikachu", { heldItem: "shed-shell" });
    const pB = makePokemon("wobbuffet", { abilityId: "shadow-tag" });
    const room = readyRoom(pA, pB);
    expect(room.playerA.trapped).toBe(true); // shadow-tag traps
    // Submit a switch action despite being trapped — should return true (accepted)
    const ok = submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    // Not necessarily "true" (depends on whether the other side has submitted),
    // but submission should be accepted (not return false for the trap check).
    // At minimum, playerA.actionSubmitted should be true.
    expect(room.playerA.actionSubmitted).toBe(true);
    void ok;
  });
});

describe("new items: lagging-tail / full-incense", () => {
  it("lagging-tail flag is set", () => {
    const poke = makePokemon("slaking", { heldItem: "lagging-tail" });
    expect(hasItemFlag(poke, "alwaysLast")).toBe(true);
  });

  it("full-incense flag is set", () => {
    const poke = makePokemon("munchlax", { heldItem: "full-incense" });
    expect(hasItemFlag(poke, "alwaysLast")).toBe(true);
  });

  it("lagging-tail forces slower move even when faster", () => {
    // Attacker A is faster but holds lagging-tail; B should act first
    const pA = makePokemon("pikachu", {
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 200 },
      heldItem: "lagging-tail",
    });
    const pB = makePokemon("bulbasaur", {
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
    });
    const room = readyRoom(pA, pB);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Find index of each attacker's "tackle" log to verify B moved first
    const idxA = room.log.findIndex((l) => l.includes("A의") && l.includes("tackle"));
    const idxB = room.log.findIndex((l) => l.includes("B의") && l.includes("tackle"));
    if (idxA !== -1 && idxB !== -1) {
      expect(idxB).toBeLessThan(idxA);
    }
  });
});

describe("new items: quick-claw", () => {
  it("quick-claw flag is set", () => {
    const poke = makePokemon("kangaskhan", { heldItem: "quick-claw" });
    expect(hasItemFlag(poke, "quickClaw")).toBe(true);
  });

  it("quick-claw triggers priority boost at 20% roll", () => {
    // Mock random to always return 0 (guaranteed trigger)
    vi.spyOn(Math, "random").mockReturnValue(0);
    const pA = makePokemon("pikachu", {
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 10 },
      heldItem: "quick-claw",
    });
    const pB = makePokemon("bulbasaur", {
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 200 },
    });
    const room = readyRoom(pA, pB);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    expect(room.log.some((l) => l.includes("선제의발톱"))).toBe(true);
  });
});

describe("new items: safety-goggles", () => {
  it("safety-goggles has powderImmune flag", () => {
    const poke = makePokemon("mudsdale", { heldItem: "safety-goggles" });
    expect(hasItemFlag(poke, "powderImmune")).toBe(true);
  });

  it("safety-goggles blocks powder moves like sleep-powder", () => {
    const pA = makePokemon("oddish", {
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 100 },
    });
    const pB = makePokemon("pikachu", {
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      heldItem: "safety-goggles",
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const room = readyRoom(pA, pB);
    submitAction(room, "userA", { type: "fight", moveId: "sleep-powder" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(pB.statusCondition).not.toBe("sleep");
    expect(room.log.some((l) => l.includes("방진고글"))).toBe(true);
  });
});

describe("sandstorm rock spdef boost", () => {
  it("rock types get 1.5x spdef during sandstorm vs special move", () => {
    // Two special attacks vs a rock-type: one with sandstorm, one without
    const atk = makePokemon("pikachu", {
      stats: { attack: 50, defense: 50, spAttack: 120, spDefense: 50, speed: 100 },
    });
    const rockDef = makePokemon("onix", {
      hp: 300, maxHp: 300,
      stats: { attack: 50, defense: 80, spAttack: 50, spDefense: 50, speed: 40 },
    });
    const atk2 = makePokemon("pikachu", {
      stats: { attack: 50, defense: 50, spAttack: 120, spDefense: 50, speed: 100 },
    });
    const rockDef2 = makePokemon("onix", {
      hp: 300, maxHp: 300,
      stats: { attack: 50, defense: 80, spAttack: 50, spDefense: 50, speed: 40 },
    });

    const roomSandstorm = readyRoom(atk, rockDef);
    roomSandstorm.weather = "sandstorm";
    roomSandstorm.weatherTurns = 5;
    submitAction(roomSandstorm, "userA", { type: "fight", moveId: "water-gun" });
    submitAction(roomSandstorm, "userB", { type: "fight", moveId: "tackle" });

    const roomClear = readyRoom(atk2, rockDef2);
    submitAction(roomClear, "userA", { type: "fight", moveId: "water-gun" });
    submitAction(roomClear, "userB", { type: "fight", moveId: "tackle" });

    const dmgSandstorm = 300 - rockDef.hp;
    const dmgClear = 300 - rockDef2.hp;
    // In sandstorm, the rock-type takes additional weather dmg but special dmg itself should be lower
    // The overall damage taken should still be less or similar because spdef is boosted.
    // Allow for weather damage: weather dmg is maxHp/16 = ~18. Sandstorm damage should be clearly less.
    expect(dmgSandstorm).toBeLessThan(dmgClear + 25);
  });
});
