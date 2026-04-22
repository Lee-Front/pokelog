import { describe, it, expect } from "vitest";
import { createRoom, selectLead, submitAction } from "../../src/pvp/pvp-room.js";
import {
  activateParadoxBoost, tryActivateParadoxOnFieldChange, triggerOnTerastalize,
} from "../../src/pvp/pvp-abilities.js";
import { getBattleTypes } from "../../src/game/pokemon-state.js";
import { computeStab } from "../../src/game/battle.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

/**
 * Cross-feature integration tests covering the matrix of Gen 9 systems:
 * fusion forms × Terastallize × Paradox boost × Ogerpon masks × Stellar.
 *
 * These tests verify the engine composes Gen 9 features coherently — they do
 * not replace the per-feature suites, which assert detailed behavior.
 */

function makePokemon(species: string, overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-uid`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 80 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
    originalTypes: ["normal"],
    teraType: "normal",
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

describe("Gen 9 Integration: Kyurem-Black + Ice Tera", () => {
  it("Kyurem-Black Terastallized to Ice gets combined STAB on Ice move (2.0x)", () => {
    // Kyurem-Black's original types are [dragon, ice]. Tera to ice gives
    // combined STAB on an ice move.
    const kyurem = makePokemon("kyurem-black", {
      originalTypes: ["dragon", "ice"],
      teraType: "ice",
      moves: [
        { id: "ice-beam", pp: 10, maxPp: 10 },
        { id: "freeze-shock", pp: 5, maxPp: 5 },
      ],
    });
    const opp = makePokemon("dragonite", {
      originalTypes: ["dragon", "flying"],
    });
    const room = createRoom(
      "userA", "A", [kyurem, makePokemon("charizard")],
      "userB", "B", [opp, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);
    submitAction(room, "userA", { type: "fight", moveId: "ice-beam", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Tera state active, types overridden
    expect(room.playerA.teraActive).toBe(true);
    expect(getBattleTypes(kyurem, room.playerA)).toEqual(["ice"]);

    // STAB 2.0x verified directly
    const stab = computeStab("ice", kyurem.originalTypes!, true, kyurem.teraType!, false);
    expect(stab).toBe(2.0);

    // Opp (dragonite) took damage (neutral at least)
    expect(opp.hp).toBeLessThan(opp.maxHp);
  });
});

describe("Gen 9 Integration: Terapagos-Stellar + Tera Starstorm", () => {
  it("Terapagos-Stellar Terastallized uses Tera Starstorm as Stellar type", () => {
    const terapagos = makePokemon("terapagos-stellar", {
      originalTypes: ["normal"],
      teraType: "stellar",
      moves: [{ id: "tera-starstorm", pp: 5, maxPp: 5 }],
      stats: { attack: 60, defense: 130, spAttack: 130, spDefense: 110, speed: 85 },
    });
    const opp = makePokemon("blissey", {
      originalTypes: ["normal"],
      stats: { attack: 10, defense: 10, spAttack: 75, spDefense: 135, speed: 55 },
    });
    const room = createRoom(
      "userA", "A", [terapagos, makePokemon("charizard")],
      "userB", "B", [opp, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    const hpBefore = opp.hp;
    submitAction(room, "userA", { type: "fight", moveId: "tera-starstorm", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.teraActive).toBe(true);
    // Terapagos-Stellar successfully used tera-starstorm (damage dealt)
    expect(opp.hp).toBeLessThan(hpBefore);
  });
});

describe("Gen 9 Integration: Paradox + Weather", () => {
  it("Great Tusk switches in under sun → Protosynthesis activates", () => {
    const tusk = makePokemon("great-tusk", {
      abilityId: "protosynthesis",
      stats: { attack: 131, defense: 115, spAttack: 53, spDefense: 70, speed: 87 },
      originalTypes: ["ground", "fighting"],
    });
    const opp = makePokemon("charizard", {
      originalTypes: ["fire", "flying"],
    });
    const room = createRoom(
      "userA", "A", [tusk, makePokemon("pikachu")],
      "userB", "B", [opp, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Simulate sun going up (e.g. Drought) then Paradox re-check
    room.weather = "sun";
    room.weatherTurns = 5;
    tryActivateParadoxOnFieldChange(room);

    expect(room.playerA.paradoxBoost).toBeDefined();
    expect(room.playerA.paradoxBoost?.source).toBe("weather");
    expect(room.playerA.paradoxBoost?.stat).toBe("attack");
  });

  it("Iron Moth under electric terrain → Quark Drive activates", () => {
    const moth = makePokemon("iron-moth", {
      abilityId: "quark-drive",
      stats: { attack: 65, defense: 90, spAttack: 140, spDefense: 110, speed: 110 },
      originalTypes: ["fire", "poison"],
    });
    const opp = makePokemon("magneton");
    const room = createRoom(
      "userA", "A", [moth, makePokemon("pikachu")],
      "userB", "B", [opp, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    room.terrain = "electric";
    room.terrainTurns = 5;
    tryActivateParadoxOnFieldChange(room);

    expect(room.playerA.paradoxBoost).toBeDefined();
    expect(room.playerA.paradoxBoost?.source).toBe("terrain");
    expect(room.playerA.paradoxBoost?.stat).toBe("spAttack");
  });
});

describe("Gen 9 Integration: Ogerpon-Wellspring + Tera + Embody Aspect", () => {
  it("Terastalizing Wellspring Ogerpon triggers +1 spDefense via Embody Aspect", () => {
    const ogerpon = makePokemon("ogerpon-wellspring-mask", {
      abilityId: "embody-aspect",
      teraType: "water",
      originalTypes: ["grass", "water"],
      moves: [{ id: "ivy-cudgel", pp: 10, maxPp: 10 }],
    });
    const opp = makePokemon("typhlosion", {
      originalTypes: ["fire"],
    });
    const room = createRoom(
      "userA", "A", [ogerpon, makePokemon("charizard")],
      "userB", "B", [opp, makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Simulate Tera activation via action (executeFight path)
    submitAction(room, "userA", { type: "fight", moveId: "ivy-cudgel", tera: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.teraActive).toBe(true);
    // Wellspring-mask Ogerpon Embody Aspect: +1 spDefense
    expect(room.playerA.statStages.spDefense).toBe(1);
  });

  it("Ogerpon (base) Tera grass triggers +1 speed via Embody Aspect", () => {
    const ogerpon = makePokemon("ogerpon", {
      abilityId: "embody-aspect",
      teraType: "grass",
      originalTypes: ["grass"],
    });
    const room = createRoom(
      "userA", "A", [ogerpon, makePokemon("charizard")],
      "userB", "B", [makePokemon("bulbasaur"), makePokemon("squirtle")],
    );
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    triggerOnTerastalize({ attacker: room.playerA, atkPoke: ogerpon, room });

    expect(room.playerA.statStages.speed).toBe(1);
  });
});
