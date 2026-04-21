import { describe, it, expect, vi } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import {
  isStatDropPrevented, hasCritPrevention, triggerOpponentStatDrop,
  triggerItemLoss, triggerFaint, triggerContactHit, canReceiveStatus,
  getEffectiveSpeed, getDefenseWithMoveMultiplier,
} from "../../src/pvp/pvp-abilities.js";
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

function readyRoom(pokeAOverrides: Partial<PvpPokemon> = {}, pokeBOverrides: Partial<PvpPokemon> = {}) {
  const pA = makePokemon("pikachu", pokeAOverrides);
  const pB = makePokemon("bulbasaur", pokeBOverrides);
  const room = createRoom(
    "userA", "A", [pA, makePokemon("charizard")],
    "userB", "B", [pB, makePokemon("squirtle")],
  );
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);
  return room;
}

describe("new abilities: switch-in boosts", () => {
  it("intrepid-sword raises attack by 1 on switch-in", () => {
    const room = readyRoom({ abilityId: "intrepid-sword" });
    expect(room.playerA.statStages.attack).toBe(1);
    expect(room.log.some((l) => l.includes("불굴의검"))).toBe(true);
  });

  it("dauntless-shield raises defense by 1 on switch-in", () => {
    const room = readyRoom({ abilityId: "dauntless-shield" });
    expect(room.playerA.statStages.defense).toBe(1);
    expect(room.log.some((l) => l.includes("불굴의방패"))).toBe(true);
  });
});

describe("new abilities: stat-drop immunity", () => {
  it("hyper-cutter blocks opponent-caused attack drops only", () => {
    const poke = makePokemon("krabby", { abilityId: "hyper-cutter" });
    expect(isStatDropPrevented(poke, "attack", true)).toBe(true);
    expect(isStatDropPrevented(poke, "defense", true)).toBe(false);
    expect(isStatDropPrevented(poke, "attack", false)).toBe(false);
  });

  it("keen-eye blocks opponent-caused accuracy drops only", () => {
    const poke = makePokemon("hitmonchan", { abilityId: "keen-eye" });
    expect(isStatDropPrevented(poke, "accuracy", true)).toBe(true);
    expect(isStatDropPrevented(poke, "speed", true)).toBe(false);
  });

  it("big-pecks blocks opponent-caused defense drops only", () => {
    const poke = makePokemon("pidgey", { abilityId: "big-pecks" });
    expect(isStatDropPrevented(poke, "defense", true)).toBe(true);
    expect(isStatDropPrevented(poke, "attack", true)).toBe(false);
  });
});

describe("new abilities: crit immunity", () => {
  it("battle-armor reports crit prevention", () => {
    const poke = makePokemon("kabuto", { abilityId: "battle-armor" });
    expect(hasCritPrevention(poke)).toBe(true);
  });

  it("shell-armor reports crit prevention", () => {
    const poke = makePokemon("lapras", { abilityId: "shell-armor" });
    expect(hasCritPrevention(poke)).toBe(true);
  });

  it("no ability => no crit prevention", () => {
    const poke = makePokemon("pikachu");
    expect(hasCritPrevention(poke)).toBe(false);
  });
});

describe("new abilities: reactive stat boosts", () => {
  it("defiant grants +2 attack when opponent drops a stat", () => {
    const pA = makePokemon("bisharp", { abilityId: "defiant" });
    const pB = makePokemon("bulbasaur");
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const reactive = triggerOpponentStatDrop(room.playerA, pA, "attack", 1, room);
    expect(reactive).toEqual([{ stat: "attack", change: 2 }]);
  });

  it("competitive grants +2 spAttack when opponent drops a stat", () => {
    const pA = makePokemon("milotic", { abilityId: "competitive" });
    const pB = makePokemon("bulbasaur");
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const reactive = triggerOpponentStatDrop(room.playerA, pA, "spAttack", 1, room);
    expect(reactive).toEqual([{ stat: "spAttack", change: 2 }]);
  });
});

describe("new abilities: unburden", () => {
  it("unburden raises speed by 2 when item is lost", () => {
    const pA = makePokemon("drifloon", { abilityId: "unburden" });
    const pB = makePokemon("bulbasaur");
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const before = room.playerA.statStages.speed;
    triggerItemLoss(room.playerA, pA, room);
    expect(room.playerA.statStages.speed).toBe(before + 2);
    expect(room.log.some((l) => l.includes("짐벗음"))).toBe(true);
  });
});

describe("new abilities: quick-feet", () => {
  it("quick-feet boosts speed by 1.5x when statused", () => {
    const statused = makePokemon("raticate", { abilityId: "quick-feet", statusCondition: "paralysis" });
    const healthy = makePokemon("raticate", { abilityId: "quick-feet" });
    expect(getEffectiveSpeed(100, statused)).toBe(150);
    expect(getEffectiveSpeed(100, healthy)).toBe(100);
  });
});

describe("new abilities: disguise", () => {
  it("disguise blocks first damaging hit and busts", () => {
    const pA = makePokemon("pikachu", {
      hp: 200, maxHp: 200,
      stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 100 },
    });
    const pB = makePokemon("mimikyu", {
      hp: 200, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      abilityId: "disguise",
    });
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    // Disguise bust: 200 max - (200/8 = 25) = 175
    // The tackle does 0 direct damage due to disguise, but bust consumes 1/8 hp
    expect(pB.hp).toBeLessThanOrEqual(175);
    expect(pB.hp).toBeGreaterThan(100);
    expect(room.playerB.volatiles.some((v) => v.id === "disguise-busted")).toBe(true);
    expect(room.log.some((l) => l.includes("디스가이즈"))).toBe(true);
  });
});

describe("new abilities: aftermath", () => {
  it("aftermath dealing 1/4 max HP to contact KOer", () => {
    const pA = makePokemon("pikachu", {
      hp: 200, maxHp: 200,
      stats: { attack: 200, defense: 50, spAttack: 50, spDefense: 50, speed: 100 },
    });
    const pB = makePokemon("stunky", {
      hp: 1, maxHp: 200,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      abilityId: "aftermath",
    });
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const atkHpBefore = pA.hp;
    // Use triggerFaint directly since test move "tackle" may not have contact flag registered
    triggerFaint({ attacker: room.playerA, atkPoke: pA, fainter: pB, room, fromContact: true });
    // Aftermath deals maxHp/4 = 50 damage
    expect(pA.hp).toBe(atkHpBefore - 50);
    expect(room.log.some((l) => l.includes("아픔분담의 반동"))).toBe(true);
  });
});

describe("new abilities: poison-touch", () => {
  it("poison-touch at 30% chance poisons defender on contact (mock random low)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const pA = makePokemon("grimer", {
      hp: 200, maxHp: 200,
      stats: { attack: 80, defense: 50, spAttack: 50, spDefense: 50, speed: 90 },
      abilityId: "poison-touch",
    });
    const pB = makePokemon("bulbasaur", {
      hp: 300, maxHp: 300,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
    });
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    submitAction(room, "userA", { type: "fight", moveId: "pound" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    // pound is a contact move; poison-touch should poison
    expect(pB.statusCondition).toBe("poison");
  });
});

describe("new abilities: veils", () => {
  it("sweet-veil blocks sleep", () => {
    const poke = makePokemon("swirlix", { abilityId: "sweet-veil" });
    expect(canReceiveStatus(poke, "sleep")).toBe(false);
    expect(canReceiveStatus(poke, "poison")).toBe(true);
  });

  it("aroma-veil blocks taunt", () => {
    const poke = makePokemon("spritzee", { abilityId: "aroma-veil" });
    expect(canReceiveStatus(poke, "taunt")).toBe(false);
    expect(canReceiveStatus(poke, "sleep")).toBe(true);
  });
});

describe("new abilities: merciless", () => {
  it("merciless always crits when target is poisoned", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const pA = makePokemon("toxapex", {
      hp: 200, maxHp: 200,
      stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 100 },
      abilityId: "merciless",
    });
    const pB = makePokemon("bulbasaur", {
      hp: 500, maxHp: 500,
      stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 },
      statusCondition: "poison",
    });
    const room = createRoom("userA", "A", [pA, makePokemon("charizard")], "userB", "B", [pB, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();
    // Merciless forces a crit, log should mention 급소
    expect(room.log.some((l) => l.includes("급소"))).toBe(true);
  });
});

describe("new abilities: fluffy", () => {
  it("fluffy doubles fire damage", () => {
    const poke = makePokemon("stufful", { abilityId: "fluffy" });
    const atk = makePokemon("pikachu");
    const fireMove = { id: "ember", name: "ember", type: "fire", category: "special" as const, power: 40, accuracy: 100, pp: 25, description: "" };
    const room = createRoom("userA", "A", [atk, makePokemon("charizard")], "userB", "B", [poke, makePokemon("squirtle")]);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const mult = getDefenseWithMoveMultiplier({
      room, attacker: room.playerA, defender: room.playerB,
      atkPoke: atk, defPoke: poke, move: fireMove, damage: 0,
    });
    expect(mult).toBe(2);
  });
});
