import { describe, it, expect, vi } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import {
  triggerOnSwitchIn, triggerOnSwitchOut, triggerEndOfTurn,
  getAttackMultiplier, getDefenseMultiplier, getEffectiveSpeed,
  canReceiveStatus,
} from "../../src/pvp/pvp-abilities.js";
import { defaultStatStages } from "../../src/game/battle.js";
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

// ── Task 3: Switch-In Abilities ──

describe("switch-in abilities", () => {
  it("intimidate lowers opponent attack on switch-in", () => {
    const room = readyRoom({ abilityId: "intimidate" });
    // After selectLead, triggerOnSwitchIn runs for both leads
    // pikachu has intimidate, so bulbasaur's attack should be lowered
    expect(room.playerB.statStages.attack).toBe(-1);
    expect(room.log.some((l) => l.includes("위협"))).toBe(true);
  });

  it("drizzle sets rain on switch-in", () => {
    const room = readyRoom({ abilityId: "drizzle" });
    expect(room.weather).toBe("rain");
    expect(room.weatherTurns).toBe(5);
    expect(room.log.some((l) => l.includes("비가 내리기 시작했다"))).toBe(true);
  });

  it("drought sets sun on switch-in", () => {
    const room = readyRoom({ abilityId: "drought" });
    expect(room.weather).toBe("sun");
  });

  it("sand-stream sets sandstorm on switch-in", () => {
    const room = readyRoom({ abilityId: "sand-stream" });
    expect(room.weather).toBe("sandstorm");
  });

  it("snow-warning sets hail on switch-in", () => {
    const room = readyRoom({ abilityId: "snow-warning" });
    expect(room.weather).toBe("hail");
  });
});

// ── Task 4: Offensive Abilities ──

describe("offensive abilities", () => {
  it("technician boosts moves with power <= 60 by 1.5x", () => {
    const room = readyRoom({ abilityId: "technician" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    // tackle has power 40
    const move = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    const ctx = { room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 0 };
    expect(getAttackMultiplier(ctx)).toBe(1.5);
  });

  it("technician does not boost moves with power > 60", () => {
    const room = readyRoom({ abilityId: "technician" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const move = { id: "earthquake", name: "earthquake", type: "ground", category: "physical" as const, power: 100, accuracy: 100, pp: 10, description: "" };
    const ctx = { room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 0 };
    expect(getAttackMultiplier(ctx)).toBe(1);
  });

  it("huge-power doubles physical attack", () => {
    const room = readyRoom({ abilityId: "huge-power" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const physicalMove = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    const specialMove = { id: "thunderbolt", name: "thunderbolt", type: "electric", category: "special" as const, power: 90, accuracy: 100, pp: 15, description: "" };
    expect(getAttackMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: physicalMove, damage: 0 })).toBe(2);
    expect(getAttackMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: specialMove, damage: 0 })).toBe(1);
  });

  it("guts boosts attack when statused", () => {
    const room = readyRoom({ abilityId: "guts", statusCondition: "burn" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const move = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    const ctx = { room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 0 };
    expect(getAttackMultiplier(ctx)).toBe(1.5);
  });

  it("guts does not boost when not statused", () => {
    const room = readyRoom({ abilityId: "guts" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const move = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    const ctx = { room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 0 };
    expect(getAttackMultiplier(ctx)).toBe(1);
  });

  it("blaze boosts fire moves at low HP", () => {
    const room = readyRoom({ abilityId: "blaze", hp: 30, maxHp: 100 });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const fireMove = { id: "ember", name: "ember", type: "fire", category: "special" as const, power: 40, accuracy: 100, pp: 25, description: "" };
    const normalMove = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    expect(getAttackMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: fireMove, damage: 0 })).toBe(1.5);
    expect(getAttackMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: normalMove, damage: 0 })).toBe(1);
  });
});

// ── Task 5: Defensive/Immunity Abilities ──

describe("defensive abilities", () => {
  it("levitate blocks ground moves (damage multiplier = 0)", () => {
    const room = readyRoom({}, { abilityId: "levitate" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const groundMove = { id: "earthquake", name: "earthquake", type: "ground", category: "physical" as const, power: 100, accuracy: 100, pp: 10, description: "" };
    const normalMove = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    expect(getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: groundMove, damage: 0 })).toBe(0);
    expect(getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: normalMove, damage: 0 })).toBe(1);
  });

  it("volt-absorb heals from electric moves and blocks damage", () => {
    const room = readyRoom({}, { abilityId: "volt-absorb", hp: 100, maxHp: 200 });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const electricMove = { id: "thunderbolt", name: "thunderbolt", type: "electric", category: "special" as const, power: 90, accuracy: 100, pp: 15, description: "" };
    const result = getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: electricMove, damage: 0 });
    expect(result).toBe(0);
    // HP should have been healed by 1/4 of maxHp = 50
    expect(defPoke.hp).toBe(150);
    expect(room.log.some((l) => l.includes("축전"))).toBe(true);
  });

  it("sturdy survives at 1 HP from full HP", () => {
    const room = readyRoom({}, { abilityId: "sturdy", hp: 200, maxHp: 200 });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const move = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    // Simulate damage >= hp
    const result = getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 250 });
    expect(result).toBe(-1); // sentinel for sturdy
    expect(room.log.some((l) => l.includes("옹골참"))).toBe(true);
  });

  it("sturdy does not activate if not at full HP", () => {
    const room = readyRoom({}, { abilityId: "sturdy", hp: 150, maxHp: 200 });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const move = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    const result = getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 250 });
    expect(result).toBe(1);
  });

  it("thick-fat halves fire and ice damage", () => {
    const room = readyRoom({}, { abilityId: "thick-fat" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const fireMove = { id: "ember", name: "ember", type: "fire", category: "special" as const, power: 40, accuracy: 100, pp: 25, description: "" };
    const iceMove = { id: "ice-beam", name: "ice-beam", type: "ice", category: "special" as const, power: 90, accuracy: 100, pp: 10, description: "" };
    const normalMove = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    expect(getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: fireMove, damage: 0 })).toBe(0.5);
    expect(getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: iceMove, damage: 0 })).toBe(0.5);
    expect(getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: normalMove, damage: 0 })).toBe(1);
  });

  it("multiscale halves damage at full HP", () => {
    const room = readyRoom({}, { abilityId: "multiscale", hp: 200, maxHp: 200 });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const move = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    expect(getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 0 })).toBe(0.5);
  });

  it("multiscale does not apply when not at full HP", () => {
    const room = readyRoom({}, { abilityId: "multiscale", hp: 199, maxHp: 200 });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const move = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    expect(getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move, damage: 0 })).toBe(1);
  });
});

// ── Task 6: Status Immunity Abilities ──

describe("status immunity abilities", () => {
  it("immunity blocks poison", () => {
    const poke = makePokemon("snorlax", { abilityId: "immunity" });
    expect(canReceiveStatus(poke, "poison")).toBe(false);
    expect(canReceiveStatus(poke, "burn")).toBe(true);
  });

  it("limber blocks paralysis", () => {
    const poke = makePokemon("persian", { abilityId: "limber" });
    expect(canReceiveStatus(poke, "paralysis")).toBe(false);
    expect(canReceiveStatus(poke, "poison")).toBe(true);
  });

  it("water-veil blocks burn", () => {
    const poke = makePokemon("goldeen", { abilityId: "water-veil" });
    expect(canReceiveStatus(poke, "burn")).toBe(false);
    expect(canReceiveStatus(poke, "paralysis")).toBe(true);
  });

  it("insomnia blocks sleep", () => {
    const poke = makePokemon("murkrow", { abilityId: "insomnia" });
    expect(canReceiveStatus(poke, "sleep")).toBe(false);
  });

  it("vital-spirit blocks sleep", () => {
    const poke = makePokemon("primeape", { abilityId: "vital-spirit" });
    expect(canReceiveStatus(poke, "sleep")).toBe(false);
  });

  it("magma-armor blocks freeze", () => {
    const poke = makePokemon("camerupt", { abilityId: "magma-armor" });
    expect(canReceiveStatus(poke, "freeze")).toBe(false);
  });

  it("clear-body blocks stat drops", () => {
    const poke = makePokemon("metagross", { abilityId: "clear-body" });
    expect(canReceiveStatus(poke, "stat-drop")).toBe(false);
    expect(canReceiveStatus(poke, "burn")).toBe(true);
  });
});

// ── Task 7: Speed/EndOfTurn/SwitchOut Abilities ──

describe("speed abilities", () => {
  it("swift-swim doubles speed in rain", () => {
    const poke = makePokemon("ludicolo", { abilityId: "swift-swim" });
    expect(getEffectiveSpeed(100, poke, "rain")).toBe(200);
    expect(getEffectiveSpeed(100, poke, "sun")).toBe(100);
    expect(getEffectiveSpeed(100, poke, undefined)).toBe(100);
  });

  it("chlorophyll doubles speed in sun", () => {
    const poke = makePokemon("venusaur", { abilityId: "chlorophyll" });
    expect(getEffectiveSpeed(80, poke, "sun")).toBe(160);
    expect(getEffectiveSpeed(80, poke, "rain")).toBe(80);
  });

  it("sand-rush doubles speed in sandstorm", () => {
    const poke = makePokemon("excadrill", { abilityId: "sand-rush" });
    expect(getEffectiveSpeed(100, poke, "sandstorm")).toBe(200);
  });

  it("slush-rush doubles speed in hail", () => {
    const poke = makePokemon("beartic", { abilityId: "slush-rush" });
    expect(getEffectiveSpeed(60, poke, "hail")).toBe(120);
  });
});

describe("end-of-turn abilities", () => {
  it("speed-boost increases speed stage each turn", () => {
    const room = readyRoom({ abilityId: "speed-boost" });
    const poke = room.playerA.party[0];
    const player = room.playerA;
    const opponent = room.playerB;

    triggerEndOfTurn({ room, player, opponent, pokemon: poke });
    expect(player.statStages.speed).toBe(1);

    triggerEndOfTurn({ room, player, opponent, pokemon: poke });
    expect(player.statStages.speed).toBe(2);
  });

  it("poison-heal heals when poisoned", () => {
    const room = readyRoom({ abilityId: "poison-heal", hp: 100, maxHp: 200, statusCondition: "poison" });
    const poke = room.playerA.party[0];
    triggerEndOfTurn({ room, player: room.playerA, opponent: room.playerB, pokemon: poke });
    // heal = max(1, floor(200/8)) = 25
    expect(poke.hp).toBe(125);
    expect(room.log.some((l) => l.includes("포이즌힐"))).toBe(true);
  });

  it("poison-heal does not heal when not poisoned", () => {
    const room = readyRoom({ abilityId: "poison-heal", hp: 100, maxHp: 200 });
    const poke = room.playerA.party[0];
    triggerEndOfTurn({ room, player: room.playerA, opponent: room.playerB, pokemon: poke });
    expect(poke.hp).toBe(100);
  });

  it("rain-dish heals in rain", () => {
    const room = readyRoom({ abilityId: "rain-dish", hp: 100, maxHp: 200 });
    room.weather = "rain";
    const poke = room.playerA.party[0];
    triggerEndOfTurn({ room, player: room.playerA, opponent: room.playerB, pokemon: poke });
    // heal = max(1, floor(200/16)) = 12
    expect(poke.hp).toBe(112);
    expect(room.log.some((l) => l.includes("레인디쉬"))).toBe(true);
  });

  it("ice-body heals in hail", () => {
    const room = readyRoom({ abilityId: "ice-body", hp: 100, maxHp: 200 });
    room.weather = "hail";
    const poke = room.playerA.party[0];
    triggerEndOfTurn({ room, player: room.playerA, opponent: room.playerB, pokemon: poke });
    expect(poke.hp).toBe(112);
    expect(room.log.some((l) => l.includes("아이스바디"))).toBe(true);
  });
});

describe("switch-out abilities", () => {
  it("natural-cure heals status on switch-out", () => {
    const room = readyRoom({ abilityId: "natural-cure", statusCondition: "paralysis" });
    const poke = room.playerA.party[0];
    expect(poke.statusCondition).toBe("paralysis");

    triggerOnSwitchOut({ player: room.playerA, pokemon: poke });
    expect(poke.statusCondition).toBeNull();
  });

  it("natural-cure does nothing when no status", () => {
    const room = readyRoom({ abilityId: "natural-cure" });
    const poke = room.playerA.party[0];
    triggerOnSwitchOut({ player: room.playerA, pokemon: poke });
    expect(poke.statusCondition).toBeNull();
  });

  it("regenerator heals 1/3 maxHp on switch-out", () => {
    const room = readyRoom({ abilityId: "regenerator", hp: 100, maxHp: 300 });
    const poke = room.playerA.party[0];
    triggerOnSwitchOut({ player: room.playerA, pokemon: poke });
    // heal = floor(300/3) = 100
    expect(poke.hp).toBe(200);
  });

  it("regenerator does not overheal", () => {
    const room = readyRoom({ abilityId: "regenerator", hp: 280, maxHp: 300 });
    const poke = room.playerA.party[0];
    triggerOnSwitchOut({ player: room.playerA, pokemon: poke });
    expect(poke.hp).toBe(300);
  });
});

// ── Task 8: Mold Breaker, Unaware, Contrary, Pressure ──

describe("mold breaker abilities", () => {
  it("mold-breaker ignores defender ability", () => {
    const room = readyRoom({ abilityId: "mold-breaker" }, { abilityId: "levitate" });
    const atkPoke = room.playerA.party[0];
    const defPoke = room.playerB.party[0];
    const groundMove = { id: "earthquake", name: "earthquake", type: "ground", category: "physical" as const, power: 100, accuracy: 100, pp: 10, description: "" };
    // With mold-breaker, levitate should be bypassed (returns 1 instead of 0)
    const result = getDefenseMultiplier({ room, attacker: room.playerA, defender: room.playerB, atkPoke, defPoke, move: groundMove, damage: 0 });
    expect(result).toBe(1);
  });
});

describe("pressure ability", () => {
  it("pressure announces on switch-in", () => {
    const room = readyRoom({ abilityId: "pressure" });
    expect(room.log.some((l) => l.includes("프레셔"))).toBe(true);
  });

  it("pressure causes opponent to use 2 PP", () => {
    const room = readyRoom(
      { moves: [{ id: "tackle", pp: 35, maxPp: 35 }] },
      { abilityId: "pressure", hp: 500, maxHp: 500, moves: [{ id: "tackle", pp: 35, maxPp: 35 }] },
    );

    vi.spyOn(Math, "random").mockReturnValue(0.5);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    vi.restoreAllMocks();

    // Player A's tackle against B (who has pressure) costs 2 PP
    const moveA = room.playerA.party[0].moves.find((m) => m.id === "tackle");
    expect(moveA!.pp).toBe(33); // 35 - 2
  });
});

// ── Integration tests ──

describe("guts integration", () => {
  it("guts burned pokemon deals full physical damage (no burn penalty)", () => {
    // Two rooms: burned+guts vs burned+no ability
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // Room 1: Burned attacker with guts
    const room1 = readyRoom(
      { abilityId: "guts", statusCondition: "burn", hp: 300, maxHp: 300, stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 60 } },
      { hp: 300, maxHp: 300, stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 } },
    );
    submitAction(room1, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room1, "userB", { type: "fight", moveId: "tackle" });
    const gutsDmg = 300 - room1.playerB.party[0].hp;

    // Room 2: Burned attacker without guts
    const room2 = readyRoom(
      { statusCondition: "burn", hp: 300, maxHp: 300, stats: { attack: 100, defense: 50, spAttack: 50, spDefense: 50, speed: 60 } },
      { hp: 300, maxHp: 300, stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 40 } },
    );
    submitAction(room2, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room2, "userB", { type: "fight", moveId: "tackle" });
    const burnedDmg = 300 - room2.playerB.party[0].hp;

    vi.restoreAllMocks();

    // Guts + burn should deal more than just burn (guts gives 1.5x AND negates burn halving)
    expect(gutsDmg).toBeGreaterThan(burnedDmg);
  });
});
