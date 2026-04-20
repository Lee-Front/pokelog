import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import {
  getAttackMultiplier, getDefenseMultiplier,
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

function readyRoom(pokeA: PvpPokemon, pokeB: PvpPokemon, extraA?: PvpPokemon, extraB?: PvpPokemon) {
  const room = createRoom(
    "userA", "A", [pokeA, extraA ?? makePokemon("charizard")],
    "userB", "B", [pokeB, extraB ?? makePokemon("squirtle")],
  );
  selectLead(room, "userA", 0);
  selectLead(room, "userB", 0);
  return room;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Abilities ──

describe("Batch 3 abilities: KO-triggered stat boost", () => {
  it("moxie boosts attack when defender faints from our attack", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const atk = makePokemon("luxray", {
      abilityId: "moxie",
      stats: { attack: 400, defense: 50, spAttack: 50, spDefense: 50, speed: 200 },
    });
    const def = makePokemon("weak", { hp: 10, maxHp: 10 });
    const room = readyRoom(atk, def);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    // No-op action for B (def is near-dead; even if B moves first it's 1hp to 0 only if tackles)
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // After resolving, if defender KO'd, moxie should push log and raise attack.
    // In forced_switch phase or finished phase depending on outcome.
    expect(room.log.some((l) => l.includes("자기과신"))).toBe(true);
    expect(room.playerA.statStages.attack).toBe(1);
  });

  it("beast-boost raises the highest stat when attacker KOs defender", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const atk = makePokemon("kartana", {
      abilityId: "beast-boost",
      // attack is highest
      stats: { attack: 400, defense: 50, spAttack: 30, spDefense: 50, speed: 200 },
    });
    const def = makePokemon("weak", { hp: 5, maxHp: 5 });
    const room = readyRoom(atk, def);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.log.some((l) => l.includes("비스트부스트"))).toBe(true);
    expect(room.playerA.statStages.attack).toBe(1);
  });
});

describe("Batch 3 abilities: damage boosts", () => {
  it("water-bubble doubles water-type damage", () => {
    const atk = makePokemon("araquanid", { abilityId: "water-bubble" });
    const def = makePokemon("target");
    const room = readyRoom(atk, def);
    const waterMove = { id: "surf", name: "surf", type: "water", category: "special" as const, power: 90, accuracy: 100, pp: 15, description: "" };
    const normalMove = { id: "tackle", name: "tackle", type: "normal", category: "physical" as const, power: 40, accuracy: 100, pp: 35, description: "" };
    const ctxW = { room, attacker: room.playerA, defender: room.playerB, atkPoke: atk, defPoke: def, move: waterMove, damage: 0 };
    const ctxN = { room, attacker: room.playerA, defender: room.playerB, atkPoke: atk, defPoke: def, move: normalMove, damage: 0 };
    expect(getAttackMultiplier(ctxW)).toBe(2);
    expect(getAttackMultiplier(ctxN)).toBe(1);
  });

  it("water-bubble halves incoming fire damage", () => {
    const atk = makePokemon("attacker");
    const def = makePokemon("araquanid", { abilityId: "water-bubble" });
    const room = readyRoom(atk, def);
    const fireMove = { id: "flamethrower", name: "flamethrower", type: "fire", category: "special" as const, power: 90, accuracy: 100, pp: 15, description: "" };
    const ctx = { room, attacker: room.playerA, defender: room.playerB, atkPoke: atk, defPoke: def, move: fireMove, damage: 0 };
    expect(getDefenseMultiplier(ctx)).toBe(0.5);
  });

  it("steelworker boosts steel-type damage by 1.5x", () => {
    const atk = makePokemon("dhelmise", { abilityId: "steelworker" });
    const def = makePokemon("target");
    const room = readyRoom(atk, def);
    const steelMove = { id: "iron-head", name: "iron-head", type: "steel", category: "physical" as const, power: 80, accuracy: 100, pp: 15, description: "" };
    const ctx = { room, attacker: room.playerA, defender: room.playerB, atkPoke: atk, defPoke: def, move: steelMove, damage: 0 };
    expect(getAttackMultiplier(ctx)).toBe(1.5);
  });

  it("tinted-lens doubles damage on not-very-effective moves", () => {
    const atk = makePokemon("butterfree", { abilityId: "tinted-lens" });
    // charizard is fire/flying; grass vs fire = 0.5 and vs flying = 0.5 → 0.25x (not very effective)
    const def = makePokemon("charizard");
    const room = readyRoom(atk, def);
    const grassMove = { id: "giga-drain", name: "giga-drain", type: "grass", category: "special" as const, power: 75, accuracy: 100, pp: 10, description: "" };
    const ctx = { room, attacker: room.playerA, defender: room.playerB, atkPoke: atk, defPoke: def, move: grassMove, damage: 0 };
    // Grass vs charizard is super-NVE; tinted-lens should return 2x
    expect(getAttackMultiplier(ctx)).toBe(2);
  });
});

describe("Batch 3 abilities: download", () => {
  it("download raises attack vs. weaker physical defense", () => {
    const atk = makePokemon("porygon", { abilityId: "download" });
    const def = makePokemon("target", {
      stats: { attack: 50, defense: 30, spAttack: 50, spDefense: 100, speed: 50 },
    });
    const room = readyRoom(atk, def);
    // download triggers on switch-in (done during readyRoom)
    expect(room.playerA.statStages.attack).toBe(1);
    expect(room.log.some((l) => l.includes("다운로드"))).toBe(true);
  });

  it("download raises spAttack vs. weaker special defense", () => {
    const atk = makePokemon("porygon", { abilityId: "download" });
    const def = makePokemon("target", {
      stats: { attack: 50, defense: 100, spAttack: 50, spDefense: 30, speed: 50 },
    });
    const room = readyRoom(atk, def);
    expect(room.playerA.statStages.spAttack).toBe(1);
  });
});

describe("Batch 3 abilities: -ate type conversion", () => {
  it("pixilate converts normal moves to fairy with 1.2x power", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // Using a dragon-type target so fairy is super-effective
    const atk = makePokemon("sylveon", {
      abilityId: "pixilate",
      stats: { attack: 50, defense: 50, spAttack: 120, spDefense: 50, speed: 60 },
    });
    const defFairy = makePokemon("dragonite", { hp: 400, maxHp: 400 });
    const roomF = readyRoom(atk, defFairy);
    // Use hyper-voice (normal-type special) so pixilate converts to fairy
    roomF.playerA.party[0].moves = [{ id: "hyper-voice", pp: 10, maxPp: 10 }];
    submitAction(roomF, "userA", { type: "fight", moveId: "hyper-voice" });
    submitAction(roomF, "userB", { type: "fight", moveId: "tackle" });
    const pixilateDmg = 400 - roomF.playerB.party[0].hp;

    // Compare to non-pixilate version (no ability)
    const atk2 = makePokemon("sylveon", {
      stats: { attack: 50, defense: 50, spAttack: 120, spDefense: 50, speed: 60 },
    });
    const defNoFairy = makePokemon("dragonite", { hp: 400, maxHp: 400 });
    const roomN = readyRoom(atk2, defNoFairy);
    roomN.playerA.party[0].moves = [{ id: "hyper-voice", pp: 10, maxPp: 10 }];
    submitAction(roomN, "userA", { type: "fight", moveId: "hyper-voice" });
    submitAction(roomN, "userB", { type: "fight", moveId: "tackle" });
    const normalDmg = 400 - roomN.playerB.party[0].hp;

    expect(pixilateDmg).toBeGreaterThan(normalDmg);
  });
});

describe("Batch 3 abilities: terrain surges", () => {
  it("electric-surge sets electric terrain on switch-in", () => {
    const atk = makePokemon("tapu-koko", { abilityId: "electric-surge" });
    const def = makePokemon("target");
    const room = readyRoom(atk, def);
    expect(room.terrain).toBe("electric");
    expect(room.terrainTurns).toBe(5);
    expect(room.log.some((l) => l.includes("일렉트릭필드"))).toBe(true);
  });

  it("grassy-surge sets grassy terrain on switch-in", () => {
    const atk = makePokemon("rillaboom", { abilityId: "grassy-surge" });
    const def = makePokemon("target");
    const room = readyRoom(atk, def);
    expect(room.terrain).toBe("grassy");
  });

  it("terrain-extender extends terrain to 8 turns", () => {
    const atk = makePokemon("tapu-koko", {
      abilityId: "electric-surge",
      heldItem: "terrain-extender",
    });
    const def = makePokemon("target");
    const room = readyRoom(atk, def);
    expect(room.terrainTurns).toBe(8);
  });
});

describe("Batch 3 abilities: weather rock items", () => {
  it("drizzle with damp-rock extends rain to 8 turns", () => {
    const atk = makePokemon("pelipper", {
      abilityId: "drizzle",
      heldItem: "damp-rock",
    });
    const def = makePokemon("target");
    const room = readyRoom(atk, def);
    expect(room.weather).toBe("rain");
    expect(room.weatherTurns).toBe(8);
  });
});

describe("Batch 3 abilities: synchronize", () => {
  it("synchronize reflects burn status back to attacker", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // roll low, ensure status lands

    const atk = makePokemon("user", {
      moves: [{ id: "will-o-wisp", pp: 10, maxPp: 10 }],
    });
    const def = makePokemon("target", { abilityId: "synchronize" });
    const room = readyRoom(atk, def);
    submitAction(room, "userA", { type: "fight", moveId: "will-o-wisp" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Only relevant if will-o-wisp actually lands burn on target
    if (room.playerB.party[0].statusCondition === "burn") {
      expect(room.playerA.party[0].statusCondition).toBe("burn");
      expect(room.log.some((l) => l.includes("싱크로"))).toBe(true);
    }
  });
});

// ── Items ──

describe("Batch 3 items: white-herb resets negative stat stages", () => {
  it("white-herb activates after opponent applies stat drop", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const atk = makePokemon("attacker", {
      // leer: opponent-targeted defense -1, statChance=100
      moves: [{ id: "leer", pp: 10, maxPp: 10 }],
    });
    const def = makePokemon("target", { heldItem: "white-herb" });
    const room = readyRoom(atk, def);
    submitAction(room, "userA", { type: "fight", moveId: "leer" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // leer lowers defender's defense. white-herb should reset it to 0 and consume.
    expect(room.playerB.statStages.defense).toBe(0);
    expect(room.playerB.party[0].heldItem).toBeNull();
    expect(room.log.some((l) => l.includes("하양허브"))).toBe(true);
  });
});

describe("Batch 3 items: clear-amulet blocks stat drops", () => {
  it("clear-amulet blocks opponent-induced stat drops without consuming", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const atk = makePokemon("attacker", {
      moves: [{ id: "leer", pp: 10, maxPp: 10 }],
    });
    const def = makePokemon("target", { heldItem: "clear-amulet" });
    const room = readyRoom(atk, def);
    submitAction(room, "userA", { type: "fight", moveId: "leer" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerB.statStages.defense).toBe(0);
    expect(room.playerB.party[0].heldItem).toBe("clear-amulet");
    expect(room.log.some((l) => l.includes("클리어액세서리"))).toBe(true);
  });
});

describe("Batch 3 items: power-herb skips two-turn charge", () => {
  it("power-herb consumes to skip solar-beam charge turn", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const atk = makePokemon("roserade", {
      heldItem: "power-herb",
      moves: [{ id: "solar-beam", pp: 10, maxPp: 10 }],
      stats: { attack: 50, defense: 50, spAttack: 120, spDefense: 50, speed: 70 },
    });
    const def = makePokemon("target", { hp: 400, maxHp: 400 });
    const room = readyRoom(atk, def);
    submitAction(room, "userA", { type: "fight", moveId: "solar-beam" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Without power-herb, solar-beam would charge; with power-herb, damage should land turn 1.
    expect(room.playerB.party[0].hp).toBeLessThan(400);
    expect(room.playerA.party[0].heldItem).toBeNull();
    expect(room.log.some((l) => l.includes("파워허브"))).toBe(true);
  });
});

describe("Batch 3 items: red-card forces attacker to switch", () => {
  it("red-card switches attacker on taking damage", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const atkA = makePokemon("atkA", { stats: { attack: 80, defense: 50, spAttack: 50, spDefense: 50, speed: 80 } });
    const benchA = makePokemon("benchA");
    const def = makePokemon("target", { heldItem: "red-card", hp: 300, maxHp: 300 });
    const benchB = makePokemon("benchB");
    const room = createRoom(
      "userA", "A", [atkA, benchA],
      "userB", "B", [def, benchB],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // After tackle, red-card should force player A to switch to benchA
    expect(room.playerA.activeIndex).toBe(1);
    expect(room.playerB.party[0].heldItem).toBeNull();
    expect(room.log.some((l) => l.includes("레드카드"))).toBe(true);
  });
});

describe("Batch 3 items: throat-spray triggers on sound move", () => {
  it("throat-spray raises spAttack after using a sound move", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const atk = makePokemon("chatot", {
      heldItem: "throat-spray",
      moves: [{ id: "hyper-voice", pp: 10, maxPp: 10 }],
      stats: { attack: 50, defense: 50, spAttack: 80, spDefense: 50, speed: 80 },
    });
    const def = makePokemon("target", { hp: 400, maxHp: 400 });
    const room = readyRoom(atk, def);
    submitAction(room, "userA", { type: "fight", moveId: "hyper-voice" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.statStages.spAttack).toBe(1);
    expect(room.playerA.party[0].heldItem).toBeNull();
    expect(room.log.some((l) => l.includes("목스프레이"))).toBe(true);
  });
});

describe("Batch 3 items: safety-goggles blocks weather damage", () => {
  it("safety-goggles prevents sandstorm chip damage", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const atk = makePokemon("tyranitar", { abilityId: "sand-stream" });
    const def = makePokemon("target", { heldItem: "safety-goggles", hp: 200, maxHp: 200 });
    const room = readyRoom(atk, def);
    const hpBefore = room.playerB.party[0].hp;
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Weather damage is 1/16 maxHp per turn; with goggles, no weather damage should be added.
    // Tackle still deals some dmg but no weather dmg line should appear for defender.
    const weatherLogsForDef = room.log.filter(l => l.includes("날씨로") && l.includes("target"));
    expect(weatherLogsForDef.length).toBe(0);
    expect(hpBefore).toBeGreaterThan(0);
  });
});
