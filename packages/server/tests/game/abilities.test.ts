import { describe, expect, it } from "vitest";
import {
  getAbility, hasAbility,
  applySwitchInAbilities,
  getAbilityOffenseMultiplier,
  checkAbilityImmunity,
  getAbilityDefenseMultiplier,
  abilityBlocksStatus,
  applyContactAbilities,
  applyEndOfTurnAbilities,
  getAbilitySpeedMultiplier,
  abilitySurvivesKO,
} from "../../src/game/abilities.js";
import { defaultStatStages } from "../../src/game/battle.js";
import type { BattleState, PrimaryStatus } from "../../../../shared/types.js";

describe("getAbility / hasAbility", () => {
  it("reads abilityId for owned pokemon", () => {
    expect(getAbility({ abilityId: "intimidate" })).toBe("intimidate");
  });
  it("reads ability for wild pokemon", () => {
    expect(getAbility({ ability: "levitate" })).toBe("levitate");
  });
  it("returns null when absent / undefined / null", () => {
    expect(getAbility({})).toBeNull();
    expect(getAbility(null)).toBeNull();
    expect(getAbility({ abilityId: null })).toBeNull();
  });
  it("hasAbility compares exact slug", () => {
    expect(hasAbility({ abilityId: "inner-focus" }, "inner-focus")).toBe(true);
    expect(hasAbility({ abilityId: "inner-focus" }, "intimidate")).toBe(false);
  });
});

describe("getAbilityOffenseMultiplier", () => {
  const frac = 0.5; // 일반 HP
  const low = 0.2;  // 1/3 이하

  it("null/unknown ability is neutral (1)", () => {
    expect(getAbilityOffenseMultiplier({}, "fire", "physical", 40, low, true, true)).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "no-such" }, "fire", "physical", 40, low, true, true)).toBe(1);
  });

  it("blaze boosts fire ×1.5 only at low HP", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "blaze" }, "fire", "special", 90, low, false, false)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "blaze" }, "fire", "special", 90, frac, false, false)).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "blaze" }, "water", "special", 90, low, false, false)).toBe(1);
  });

  it("overgrow/torrent/swarm match their type", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "overgrow" }, "grass", "physical", 50, low, false, false)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "torrent" }, "water", "physical", 50, low, false, false)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "swarm" }, "bug", "physical", 50, low, false, false)).toBeCloseTo(1.5);
  });

  it("technician boosts power<=60 ×1.5", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "technician" }, "normal", "physical", 60, frac, false, false)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "technician" }, "normal", "physical", 61, frac, false, false)).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "technician" }, "normal", "physical", 0, frac, false, false)).toBe(1);
  });

  it("huge-power/pure-power double physical only", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "huge-power" }, "normal", "physical", 80, frac, false, false)).toBe(2);
    expect(getAbilityOffenseMultiplier({ abilityId: "pure-power" }, "normal", "special", 80, frac, false, false)).toBe(1);
  });

  it("guts boosts physical only with a status", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "guts" }, "normal", "physical", 80, frac, false, true)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "guts" }, "normal", "physical", 80, frac, false, false)).toBe(1);
  });

  it("adaptability adds ×(2/1.5) only when STAB", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "adaptability" }, "fire", "special", 90, frac, true, false)).toBeCloseTo(2 / 1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "adaptability" }, "fire", "special", 90, frac, false, false)).toBe(1);
  });
});

describe("checkAbilityImmunity", () => {
  it("null/unknown ability is not immune", () => {
    expect(checkAbilityImmunity({}, "ground", "physical").immune).toBe(false);
    expect(checkAbilityImmunity({ abilityId: "no-such" }, "ground", "physical").immune).toBe(false);
  });

  it("status moves never trigger immunity", () => {
    expect(checkAbilityImmunity({ abilityId: "levitate" }, "ground", "status").immune).toBe(false);
  });

  it("levitate blocks ground only", () => {
    expect(checkAbilityImmunity({ abilityId: "levitate" }, "ground", "physical")).toEqual({ immune: true });
    expect(checkAbilityImmunity({ abilityId: "levitate" }, "rock", "physical").immune).toBe(false);
  });

  it("volt-absorb / water-absorb / dry-skin heal 1/4", () => {
    expect(checkAbilityImmunity({ abilityId: "volt-absorb" }, "electric", "special")).toEqual({ immune: true, healFraction: 1 / 4 });
    expect(checkAbilityImmunity({ abilityId: "water-absorb" }, "water", "special")).toEqual({ immune: true, healFraction: 1 / 4 });
    expect(checkAbilityImmunity({ abilityId: "dry-skin" }, "water", "physical")).toEqual({ immune: true, healFraction: 1 / 4 });
  });

  it("flash-fire immune to fire with no heal", () => {
    expect(checkAbilityImmunity({ abilityId: "flash-fire" }, "fire", "special")).toEqual({ immune: true });
  });

  it("boost-on-immunity abilities raise the right stat", () => {
    expect(checkAbilityImmunity({ abilityId: "lightning-rod" }, "electric", "special")).toEqual({ immune: true, boostStat: "spAttack" });
    expect(checkAbilityImmunity({ abilityId: "storm-drain" }, "water", "special")).toEqual({ immune: true, boostStat: "spAttack" });
    expect(checkAbilityImmunity({ abilityId: "motor-drive" }, "electric", "physical")).toEqual({ immune: true, boostStat: "speed" });
    expect(checkAbilityImmunity({ abilityId: "sap-sipper" }, "grass", "special")).toEqual({ immune: true, boostStat: "attack" });
  });
});

describe("getAbilityDefenseMultiplier", () => {
  it("null/unknown ability is neutral (1)", () => {
    expect(getAbilityDefenseMultiplier({}, "fire", 1, true)).toBe(1);
    expect(getAbilityDefenseMultiplier({ abilityId: "no-such" }, "fire", 1, true)).toBe(1);
  });

  it("thick-fat halves fire & ice", () => {
    expect(getAbilityDefenseMultiplier({ abilityId: "thick-fat" }, "fire", 0.5, false)).toBe(0.5);
    expect(getAbilityDefenseMultiplier({ abilityId: "thick-fat" }, "ice", 0.5, false)).toBe(0.5);
    expect(getAbilityDefenseMultiplier({ abilityId: "thick-fat" }, "water", 0.5, false)).toBe(1);
  });

  it("heatproof halves fire only", () => {
    expect(getAbilityDefenseMultiplier({ abilityId: "heatproof" }, "fire", 0.5, false)).toBe(0.5);
    expect(getAbilityDefenseMultiplier({ abilityId: "heatproof" }, "ice", 0.5, false)).toBe(1);
  });

  it("multiscale halves only at full HP", () => {
    expect(getAbilityDefenseMultiplier({ abilityId: "multiscale" }, "normal", 1, false)).toBe(0.5);
    expect(getAbilityDefenseMultiplier({ abilityId: "multiscale" }, "normal", 0.99, false)).toBe(1);
  });

  it("filter/solid-rock/prism-armor ×0.75 only when super-effective", () => {
    expect(getAbilityDefenseMultiplier({ abilityId: "filter" }, "fire", 0.5, true)).toBe(0.75);
    expect(getAbilityDefenseMultiplier({ abilityId: "solid-rock" }, "fire", 0.5, true)).toBe(0.75);
    expect(getAbilityDefenseMultiplier({ abilityId: "prism-armor" }, "fire", 0.5, true)).toBe(0.75);
    expect(getAbilityDefenseMultiplier({ abilityId: "filter" }, "fire", 0.5, false)).toBe(1);
  });
});

describe("abilityBlocksStatus", () => {
  const cases: Array<[string, PrimaryStatus, boolean]> = [
    ["limber", "paralysis", true],
    ["limber", "burn", false],
    ["immunity", "poison", true],
    ["insomnia", "sleep", true],
    ["vital-spirit", "sleep", true],
    ["water-veil", "burn", true],
    ["magma-armor", "freeze", true],
  ];
  it.each(cases)("%s vs %s -> %s", (ability, status, expected) => {
    expect(abilityBlocksStatus({ abilityId: ability }, status)).toBe(expected);
  });
  it("null/unknown blocks nothing", () => {
    expect(abilityBlocksStatus({}, "poison")).toBe(false);
    expect(abilityBlocksStatus({ abilityId: "no-such" }, "poison")).toBe(false);
  });
});

describe("applyContactAbilities (injected random)", () => {
  it("null/unknown ability does nothing", () => {
    expect(applyContactAbilities({}, false, 100, () => 0)).toEqual({});
  });

  it("static paralyzes when roll < 0.3 and attacker has no status", () => {
    expect(applyContactAbilities({ abilityId: "static" }, false, 100, () => 0.1)).toEqual({ inflictStatus: "paralysis" });
    expect(applyContactAbilities({ abilityId: "static" }, false, 100, () => 0.9)).toEqual({});
  });

  it("flame-body / poison-point inflict their status", () => {
    expect(applyContactAbilities({ abilityId: "flame-body" }, false, 100, () => 0).inflictStatus).toBe("burn");
    expect(applyContactAbilities({ abilityId: "poison-point" }, false, 100, () => 0).inflictStatus).toBe("poison");
  });

  it("does not inflict when attacker already has a status", () => {
    expect(applyContactAbilities({ abilityId: "static" }, true, 100, () => 0).inflictStatus).toBeUndefined();
  });

  it("rough-skin / iron-barbs deal maxHp/8 recoil", () => {
    expect(applyContactAbilities({ abilityId: "rough-skin" }, true, 80, () => 0).recoilDamage).toBe(10);
    expect(applyContactAbilities({ abilityId: "iron-barbs" }, true, 4, () => 0).recoilDamage).toBe(1); // min 1
  });
});

describe("applyEndOfTurnAbilities", () => {
  it("null/unknown ability is neutral", () => {
    expect(applyEndOfTurnAbilities({}, "rain", false, 100)).toEqual({ healing: 0, cancelPoison: false, speedBoost: false });
  });

  it("speed-boost flags speedBoost", () => {
    expect(applyEndOfTurnAbilities({ abilityId: "speed-boost" }, undefined, false, 100).speedBoost).toBe(true);
  });

  it("rain-dish heals 1/16 in rain only", () => {
    expect(applyEndOfTurnAbilities({ abilityId: "rain-dish" }, "rain", false, 160).healing).toBe(10);
    expect(applyEndOfTurnAbilities({ abilityId: "rain-dish" }, "sun", false, 160).healing).toBe(0);
  });

  it("ice-body heals 1/16 in hail only", () => {
    expect(applyEndOfTurnAbilities({ abilityId: "ice-body" }, "hail", false, 160).healing).toBe(10);
    expect(applyEndOfTurnAbilities({ abilityId: "ice-body" }, "rain", false, 160).healing).toBe(0);
  });

  it("dry-skin heals 1/8 in rain, hurts 1/8 in sun", () => {
    expect(applyEndOfTurnAbilities({ abilityId: "dry-skin" }, "rain", false, 80).healing).toBe(10);
    expect(applyEndOfTurnAbilities({ abilityId: "dry-skin" }, "sun", false, 80).healing).toBe(-10);
    expect(applyEndOfTurnAbilities({ abilityId: "dry-skin" }, "hail", false, 80).healing).toBe(0);
  });

  it("poison-heal cancels poison and heals 1/8 when poisoned", () => {
    expect(applyEndOfTurnAbilities({ abilityId: "poison-heal" }, undefined, true, 80)).toMatchObject({ healing: 10, cancelPoison: true });
    expect(applyEndOfTurnAbilities({ abilityId: "poison-heal" }, undefined, false, 80)).toMatchObject({ healing: 0, cancelPoison: false });
  });
});

describe("getAbilitySpeedMultiplier", () => {
  it("null/unknown is 1", () => {
    expect(getAbilitySpeedMultiplier({}, "rain")).toBe(1);
    expect(getAbilitySpeedMultiplier({ abilityId: "no-such" }, "rain")).toBe(1);
  });
  it("doubles speed in matching weather only", () => {
    expect(getAbilitySpeedMultiplier({ abilityId: "swift-swim" }, "rain")).toBe(2);
    expect(getAbilitySpeedMultiplier({ abilityId: "swift-swim" }, "sun")).toBe(1);
    expect(getAbilitySpeedMultiplier({ abilityId: "chlorophyll" }, "sun")).toBe(2);
    expect(getAbilitySpeedMultiplier({ abilityId: "sand-rush" }, "sandstorm")).toBe(2);
    expect(getAbilitySpeedMultiplier({ abilityId: "slush-rush" }, "hail")).toBe(2);
    expect(getAbilitySpeedMultiplier({ abilityId: "swift-swim" }, undefined)).toBe(1);
  });
});

describe("abilitySurvivesKO (sturdy)", () => {
  it("survives an OHKO only at full HP", () => {
    expect(abilitySurvivesKO({ abilityId: "sturdy" }, true)).toBe(true);
    expect(abilitySurvivesKO({ abilityId: "sturdy" }, false)).toBe(false);
  });
  it("null/unknown never survives", () => {
    expect(abilitySurvivesKO({}, true)).toBe(false);
    expect(abilitySurvivesKO({ abilityId: "no-such" }, true)).toBe(false);
  });
});

describe("applySwitchInAbilities", () => {
  function makeBattle(): BattleState {
    return {
      eventId: "e1",
      myPokemonUid: "p1",
      turn: 0,
      wild: { species: "rattata", level: 5, hp: 20, maxHp: 20, stats: { attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 10 }, moves: [] },
      playerStatStages: defaultStatStages(),
      wildStatStages: defaultStatStages(),
      playerVolatile: [],
      wildVolatile: [],
    };
  }

  it("null/unknown ability does nothing (byte-identical)", () => {
    const battle = makeBattle();
    const log: string[] = [];
    const opp = defaultStatStages();
    const result = applySwitchInAbilities(battle, "player", {}, opp, log);
    expect(result).toBe(opp); // 동일 참조 반환
    expect(log).toEqual([]);
    expect(battle.weather).toBeUndefined();
    expect(battle.terrain).toBeUndefined();
  });

  it("intimidate lowers opponent attack by 1", () => {
    const battle = makeBattle();
    const log: string[] = [];
    const result = applySwitchInAbilities(battle, "player", { abilityId: "intimidate" }, defaultStatStages(), log);
    expect(result?.attack).toBe(-1);
    expect(log[0]).toContain("위협");
  });

  it("weather setter sets weather only when none present", () => {
    const battle = makeBattle();
    const log: string[] = [];
    applySwitchInAbilities(battle, "wild", { ability: "drizzle" }, defaultStatStages(), log);
    expect(battle.weather).toBe("rain");
    expect(battle.weatherTurns).toBeGreaterThan(0);

    // 이미 날씨가 있으면 덮어쓰지 않는다
    const battle2 = makeBattle();
    battle2.weather = "sun";
    applySwitchInAbilities(battle2, "wild", { ability: "drizzle" }, defaultStatStages(), []);
    expect(battle2.weather).toBe("sun");
  });

  it("terrain setter sets terrain only when none present", () => {
    const battle = makeBattle();
    applySwitchInAbilities(battle, "player", { abilityId: "electric-surge" }, defaultStatStages(), []);
    expect(battle.terrain).toBe("electric");
    expect(battle.terrainTurns).toBeGreaterThan(0);
  });
});
