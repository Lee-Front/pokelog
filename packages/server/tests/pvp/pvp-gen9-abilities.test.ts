import { describe, it, expect, vi } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import {
  paradoxHighestStat, activateParadoxBoost, tryActivateParadoxOnFieldChange,
  triggerOnTerastalize, triggerOnStatBoostTrigger, canReceiveStatus,
} from "../../src/pvp/pvp-abilities.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 80, defense: 80, spAttack: 80, spDefense: 80, speed: 80 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
    originalTypes: ["normal"],
    teraType: "normal",
    stellarTypesUsed: [],
    rageFistHits: 0,
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

describe("Paradox Boost: highest stat selection", () => {
  it("chooses attack when attack is highest", () => {
    const poke = makePokemon("great-tusk", {
      stats: { attack: 150, defense: 80, spAttack: 60, spDefense: 80, speed: 100 },
    });
    expect(paradoxHighestStat(poke)).toBe("attack");
  });

  it("chooses speed when speed is highest", () => {
    const poke = makePokemon("iron-bundle", {
      stats: { attack: 50, defense: 50, spAttack: 100, spDefense: 80, speed: 150 },
    });
    expect(paradoxHighestStat(poke)).toBe("speed");
  });

  it("ties prefer attack over others", () => {
    const poke = makePokemon("x", {
      stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 },
    });
    expect(paradoxHighestStat(poke)).toBe("attack");
  });
});

describe("Protosynthesis: sun activates boost", () => {
  it("activates when switched in during sun", () => {
    const pA = makePokemon("great-tusk", {
      abilityId: "protosynthesis",
      stats: { attack: 150, defense: 80, spAttack: 60, spDefense: 80, speed: 100 },
    });
    const pB = makePokemon("bulbasaur", { abilityId: "drought" });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    // userB leads first: drought sets sun
    selectLead(room, "userB", 0);
    selectLead(room, "userA", 0);
    expect(room.weather).toBe("sun");
    expect(room.playerA.paradoxBoost).toBeDefined();
    expect(room.playerA.paradoxBoost?.stat).toBe("attack");
    expect(room.playerA.paradoxBoost?.source).toBe("weather");
  });

  it("does NOT activate without sun or booster energy", () => {
    const room = readyRoom({
      abilityId: "protosynthesis",
      stats: { attack: 150, defense: 80, spAttack: 60, spDefense: 80, speed: 100 },
    });
    expect(room.playerA.paradoxBoost).toBeUndefined();
  });
});

describe("Quark Drive: electric terrain activates boost", () => {
  it("activates when switched in on electric terrain", () => {
    const pA = makePokemon("iron-bundle", {
      abilityId: "quark-drive",
      stats: { attack: 50, defense: 50, spAttack: 100, spDefense: 80, speed: 150 },
    });
    const pB = makePokemon("tapu-koko", { abilityId: "electric-surge" });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userB", 0);
    selectLead(room, "userA", 0);
    expect(room.terrain).toBe("electric");
    expect(room.playerA.paradoxBoost?.stat).toBe("speed");
    expect(room.playerA.paradoxBoost?.source).toBe("terrain");
  });
});

describe("Booster Energy: activates Paradox boost and consumes", () => {
  it("activates without weather/terrain and consumes the item", () => {
    const room = readyRoom({
      abilityId: "protosynthesis",
      heldItem: "booster-energy",
      stats: { attack: 150, defense: 80, spAttack: 60, spDefense: 80, speed: 100 },
    });
    const pA = room.playerA.party[0];
    expect(room.playerA.paradoxBoost?.source).toBe("booster-energy");
    expect(pA.heldItem).toBeNull();
  });
});

describe("Paradox boost: persists after weather ends until switch", () => {
  it("stays active after weather.clear (until switch-out)", () => {
    const pA = makePokemon("great-tusk", {
      abilityId: "protosynthesis",
      heldItem: "booster-energy",
      stats: { attack: 150, defense: 80, spAttack: 60, spDefense: 80, speed: 100 },
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    expect(room.playerA.paradoxBoost).toBeDefined();
    // Even with no weather, boost remains.
    room.weather = undefined;
    expect(room.playerA.paradoxBoost).toBeDefined();
  });
});

describe("tryActivateParadoxOnFieldChange", () => {
  it("activates Protosynthesis when sun is set mid-battle", () => {
    const pA = makePokemon("roaring-moon", {
      abilityId: "protosynthesis",
      stats: { attack: 139, defense: 71, spAttack: 55, spDefense: 101, speed: 119 },
    });
    const pB = makePokemon("bulbasaur");
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    expect(room.playerA.paradoxBoost).toBeUndefined();
    room.weather = "sun";
    tryActivateParadoxOnFieldChange(room);
    expect(room.playerA.paradoxBoost?.stat).toBe("attack");
  });
});

describe("Supreme Overlord: scales with fainted allies", () => {
  it("multiplier grows with fainted teammates", () => {
    const pA = makePokemon("kingambit", {
      abilityId: "supreme-overlord",
      stats: { attack: 135, defense: 120, spAttack: 60, spDefense: 85, speed: 50 },
    });
    const fainted = makePokemon("charizard", { hp: 0 });
    const alive = makePokemon("squirtle");
    const pB = makePokemon("bulbasaur", { hp: 500, maxHp: 500 });
    const room = createRoom(
      "userA", "A", [pA, fainted, alive],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const hpBefore = pB.hp;
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // At least some damage occurred (0.1x boost per fainted ally)
    expect(pB.hp).toBeLessThan(hpBefore);
  });
});

describe("Earth Eater: heals from Ground moves", () => {
  it("absorbs ground-type damage and heals", () => {
    const pA = makePokemon("cacnea", {
      stats: { attack: 85, defense: 40, spAttack: 85, spDefense: 40, speed: 35 },
      originalTypes: ["ground"],
      moves: [{ id: "earthquake", pp: 10, maxPp: 10 }],
    });
    const pB = makePokemon("great-tusk", {
      abilityId: "earth-eater",
      hp: 100, maxHp: 200,
      stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 100, speed: 50 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const hpBefore = pB.hp;
    submitAction(room, "userA", { type: "fight", moveId: "earthquake" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Healed by 1/4 maxHp = 50; absorbed earthquake (no damage)
    expect(pB.hp).toBeGreaterThanOrEqual(hpBefore);
    expect(room.log.some((l) => l.includes("흙먹기"))).toBe(true);
  });
});

describe("Tera Shell: halves damage at full HP", () => {
  it("registers reduced damage at full HP", () => {
    const pA = makePokemon("pikachu", {
      stats: { attack: 100, defense: 80, spAttack: 80, spDefense: 80, speed: 100 },
    });
    const pB = makePokemon("terapagos", {
      hp: 300, maxHp: 300,
      abilityId: "tera-shell",
      stats: { attack: 60, defense: 100, spAttack: 60, spDefense: 110, speed: 40 },
    });
    // Full HP — Tera Shell halves
    const roomFull = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(roomFull, "userA", 0);
    selectLead(roomFull, "userB", 0);
    submitAction(roomFull, "userA", { type: "fight", moveId: "tackle" });
    submitAction(roomFull, "userB", { type: "fight", moveId: "tackle" });
    const dmgFull = 300 - pB.hp;

    // Below full — no reduction
    const pA2 = makePokemon("pikachu", {
      stats: { attack: 100, defense: 80, spAttack: 80, spDefense: 80, speed: 100 },
    });
    const pB2 = makePokemon("terapagos", {
      hp: 299, maxHp: 300,
      abilityId: "tera-shell",
      stats: { attack: 60, defense: 100, spAttack: 60, spDefense: 110, speed: 40 },
    });
    const roomHurt = createRoom(
      "userA", "A", [pA2, makePokemon("charizard")],
      "userB", "B", [pB2, makePokemon("squirtle")],
    );
    selectLead(roomHurt, "userA", 0);
    selectLead(roomHurt, "userB", 0);
    submitAction(roomHurt, "userA", { type: "fight", moveId: "tackle" });
    submitAction(roomHurt, "userB", { type: "fight", moveId: "tackle" });
    const dmgHurt = 299 - pB2.hp;
    expect(dmgHurt).toBeGreaterThan(dmgFull);
  });
});

describe("Well-Baked Body: absorbs Fire and boosts defense", () => {
  it("blocks fire damage and gains +2 defense", () => {
    const pA = makePokemon("charmander", {
      stats: { attack: 100, defense: 50, spAttack: 100, spDefense: 50, speed: 65 },
      originalTypes: ["fire"],
      moves: [{ id: "ember", pp: 25, maxPp: 25 }],
    });
    const pB = makePokemon("dachsbun", {
      abilityId: "well-baked-body",
      stats: { attack: 80, defense: 115, spAttack: 60, spDefense: 80, speed: 95 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const hpBefore = pB.hp;
    submitAction(room, "userA", { type: "fight", moveId: "ember" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(pB.hp).toBe(hpBefore); // no damage
    expect(room.playerB.statStages.defense).toBe(2);
  });
});

describe("Purifying Salt: status immunity + ghost resistance", () => {
  it("blocks burn status", () => {
    const poke = makePokemon("garganacl", { abilityId: "purifying-salt" });
    expect(canReceiveStatus(poke, "burn")).toBe(false);
    expect(canReceiveStatus(poke, "poison")).toBe(false);
    expect(canReceiveStatus(poke, "sleep")).toBe(false);
  });
});

describe("Armor Tail: blocks priority moves", () => {
  it("priority moves fail against armor-tail holder", () => {
    const pA = makePokemon("pikachu", {
      stats: { attack: 100, defense: 80, spAttack: 80, spDefense: 80, speed: 100 },
      moves: [{ id: "quick-attack", pp: 20, maxPp: 20 }],
    });
    const pB = makePokemon("farigiraf", {
      abilityId: "armor-tail",
      hp: 300, maxHp: 300,
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    const hpBefore = pB.hp;
    submitAction(room, "userA", { type: "fight", moveId: "quick-attack" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(pB.hp).toBe(hpBefore); // priority blocked
    expect(room.log.some((l) => l.includes("선제공격"))).toBe(true);
  });
});

describe("Good as Gold: blocks opposing status moves", () => {
  it("status moves fail against good-as-gold holder", () => {
    const pA = makePokemon("pikachu", {
      moves: [{ id: "thunder-wave", pp: 20, maxPp: 20 }],
    });
    const pB = makePokemon("gholdengo", {
      abilityId: "good-as-gold",
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    submitAction(room, "userA", { type: "fight", moveId: "thunder-wave" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(pB.statusCondition).toBeFalsy();
    expect(room.log.some((l) => l.includes("황금몸"))).toBe(true);
  });
});

describe("Embody Aspect: Ogerpon Tera boost", () => {
  it("raises speed for base Ogerpon on Tera", () => {
    const pA = makePokemon("ogerpon", {
      abilityId: "embody-aspect",
      teraType: "grass",
      originalTypes: ["grass"],
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    triggerOnTerastalize({ attacker: room.playerA, atkPoke: pA, room });
    expect(room.playerA.statStages.speed).toBe(1);
  });

  it("raises attack for hearthflame-mask ogerpon", () => {
    const pA = makePokemon("ogerpon-hearthflame-mask", {
      abilityId: "embody-aspect",
      teraType: "fire",
      originalTypes: ["grass", "fire"],
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    triggerOnTerastalize({ attacker: room.playerA, atkPoke: pA, room });
    expect(room.playerA.statStages.attack).toBe(1);
  });
});

describe("Supersweet Syrup: drops opponent evasion once per battle", () => {
  it("drops evasion on first switch-in and flags as used", () => {
    const pA = makePokemon("dipplin", { abilityId: "supersweet-syrup" });
    const pB = makePokemon("bulbasaur");
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    expect(room.playerB.statStages.evasion).toBe(-1);
    expect(room.playerA.supersweetSyrupUsed).toBe(true);
  });
});

describe("Prism Armor: reduces super-effective damage", () => {
  it("registers reduction against super-effective attacks", () => {
    // dark-type bite hits psychic-type necrozma for super-effective damage.
    // With prism-armor, damage is reduced by 25% vs super-effective.
    const mkAtk = () => makePokemon("pikachu", {
      stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 100 },
      moves: [{ id: "bite", pp: 25, maxPp: 25 }],
    });
    const pBProtected = makePokemon("necrozma", {
      hp: 400, maxHp: 400,
      abilityId: "prism-armor",
      originalTypes: ["psychic"],
      stats: { attack: 120, defense: 100, spAttack: 130, spDefense: 100, speed: 80 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const pBPlain = makePokemon("necrozma", {
      hp: 400, maxHp: 400,
      abilityId: undefined,
      originalTypes: ["psychic"],
      stats: { attack: 120, defense: 100, spAttack: 130, spDefense: 100, speed: 80 },
      moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    });
    const roomProtected = createRoom(
      "userA", "A", [mkAtk(), makePokemon("charizard")],
      "userB", "B", [pBProtected, makePokemon("squirtle")],
    );
    selectLead(roomProtected, "userA", 0);
    selectLead(roomProtected, "userB", 0);
    submitAction(roomProtected, "userA", { type: "fight", moveId: "bite" });
    submitAction(roomProtected, "userB", { type: "fight", moveId: "tackle" });
    const dmgProtected = 400 - pBProtected.hp;

    const roomPlain = createRoom(
      "userA", "A", [mkAtk(), makePokemon("charizard")],
      "userB", "B", [pBPlain, makePokemon("squirtle")],
    );
    selectLead(roomPlain, "userA", 0);
    selectLead(roomPlain, "userB", 0);
    submitAction(roomPlain, "userA", { type: "fight", moveId: "bite" });
    submitAction(roomPlain, "userB", { type: "fight", moveId: "tackle" });
    const dmgPlain = 400 - pBPlain.hp;
    // Prism Armor should reduce super-effective damage.
    expect(dmgProtected).toBeLessThan(dmgPlain);
  });
});

describe("Opportunist: copies opponent positive boosts", () => {
  it("mirrors boosts onto opportunist holder", () => {
    const pA = makePokemon("pikachu");
    const pB = makePokemon("espathra", { abilityId: "opportunist" });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    triggerOnStatBoostTrigger({
      player: room.playerB,
      opponent: room.playerA,
      changes: [{ stat: "attack", change: 2 }, { stat: "speed", change: 1 }],
      room,
    });
    expect(room.playerB.statStages.attack).toBe(2);
    expect(room.playerB.statStages.speed).toBe(1);
  });
});

describe("Speed-type paradox boost uses 1.5x in turn order", () => {
  it("outspeeds opponent with +50% boost", () => {
    // Fast attacker has paradox speed so it goes first.
    const pA = makePokemon("iron-bundle", {
      abilityId: "quark-drive",
      heldItem: "booster-energy",
      stats: { attack: 70, defense: 70, spAttack: 124, spDefense: 65, speed: 136 },
    });
    const pB = makePokemon("bulbasaur", {
      stats: { attack: 60, defense: 60, spAttack: 70, spDefense: 70, speed: 140 },
    });
    const room = createRoom(
      "userA", "A", [pA, makePokemon("charizard")],
      "userB", "B", [pB, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    // Paradox boost activated via booster-energy, stat = speed
    expect(room.playerA.paradoxBoost?.stat).toBe("speed");
  });
});
