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
  attackerBreaksMold,
  abilityNullifiesNonSuperEffective,
  abilityBlocksIndirectDamage,
  resolveUnawareStages,
  applyContraryToChange,
  checkDisguiseBreak,
  isIronFistMove,
  isSlicingMove, isBitingMove, isPulseMove, isSoundMove,
  getKnockoutBoost,
} from "../../src/game/abilities.js";
import { defaultStatStages } from "../../src/game/battle.js";
import type { BattleState, PrimaryStatus, StatStages } from "../../../../shared/types.js";

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

// ---------------------------------------------------------------------------
// New abilities (batch 2)
// ---------------------------------------------------------------------------

describe("getAbilityOffenseMultiplier — context-driven abilities", () => {
  const frac = 0.5;

  it("null/unknown stays neutral even with a full context", () => {
    const ctx = { isSuperEffective: true, notVeryEffective: true, isCritical: true, hasSecondary: true, isRecoilMove: true, isPunchMove: true, isContact: true, weather: "sandstorm" as const };
    expect(getAbilityOffenseMultiplier({}, "rock", "physical", 80, frac, false, false, ctx)).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "no-such" }, "rock", "physical", 80, frac, false, false, ctx)).toBe(1);
  });

  it("omitting the context leaves conditional abilities inert (byte-identical)", () => {
    // sheer-force only fires when ctx.hasSecondary; with no context → 1
    expect(getAbilityOffenseMultiplier({ abilityId: "sheer-force" }, "normal", "physical", 80, frac, false, false)).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "sniper" }, "normal", "physical", 80, frac, false, false)).toBe(1);
  });

  it("sheer-force ×1.3 only for damaging moves with a secondary", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "sheer-force" }, "normal", "physical", 80, frac, false, false, { hasSecondary: true })).toBeCloseTo(1.3);
    expect(getAbilityOffenseMultiplier({ abilityId: "sheer-force" }, "normal", "physical", 80, frac, false, false, { hasSecondary: false })).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "sheer-force" }, "normal", "status", 0, frac, false, false, { hasSecondary: true })).toBe(1);
  });

  it("reckless ×1.2 only for recoil moves", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "reckless" }, "normal", "physical", 120, frac, false, false, { isRecoilMove: true })).toBeCloseTo(1.2);
    expect(getAbilityOffenseMultiplier({ abilityId: "reckless" }, "normal", "physical", 120, frac, false, false, { isRecoilMove: false })).toBe(1);
  });

  it("iron-fist ×1.2 only for punch moves", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "iron-fist" }, "fire", "physical", 75, frac, false, false, { isPunchMove: true })).toBeCloseTo(1.2);
    expect(getAbilityOffenseMultiplier({ abilityId: "iron-fist" }, "fire", "physical", 75, frac, false, false, { isPunchMove: false })).toBe(1);
  });

  it("tough-claws ×1.3 only on contact", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "tough-claws" }, "normal", "physical", 80, frac, false, false, { isContact: true })).toBeCloseTo(1.3);
    expect(getAbilityOffenseMultiplier({ abilityId: "tough-claws" }, "normal", "special", 80, frac, false, false, { isContact: false })).toBe(1);
  });

  it("sand-force ×1.3 for rock/ground/steel in sandstorm only", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "sand-force" }, "rock", "physical", 80, frac, false, false, { weather: "sandstorm" })).toBeCloseTo(1.3);
    expect(getAbilityOffenseMultiplier({ abilityId: "sand-force" }, "steel", "physical", 80, frac, false, false, { weather: "sandstorm" })).toBeCloseTo(1.3);
    expect(getAbilityOffenseMultiplier({ abilityId: "sand-force" }, "water", "physical", 80, frac, false, false, { weather: "sandstorm" })).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "sand-force" }, "rock", "physical", 80, frac, false, false, { weather: "rain" })).toBe(1);
  });

  it("sniper ×1.5 on critical, tinted-lens ×2 on resisted, neuroforce ×1.25 on super-effective", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "sniper" }, "normal", "physical", 80, frac, false, false, { isCritical: true })).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "sniper" }, "normal", "physical", 80, frac, false, false, { isCritical: false })).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "tinted-lens" }, "normal", "physical", 80, frac, false, false, { notVeryEffective: true })).toBe(2);
    expect(getAbilityOffenseMultiplier({ abilityId: "tinted-lens" }, "normal", "physical", 80, frac, false, false, { notVeryEffective: false })).toBe(1);
    expect(getAbilityOffenseMultiplier({ abilityId: "neuroforce" }, "normal", "physical", 80, frac, false, false, { isSuperEffective: true })).toBeCloseTo(1.25);
  });
});

describe("isIronFistMove", () => {
  it("recognizes real punch moves but not sucker-punch", () => {
    expect(isIronFistMove("fire-punch")).toBe(true);
    expect(isIronFistMove("mach-punch")).toBe(true);
    expect(isIronFistMove("sucker-punch")).toBe(false);
    expect(isIronFistMove("tackle")).toBe(false);
  });
});

describe("attackerBreaksMold", () => {
  it("true for mold-breaker/turboblaze/teravolt, false otherwise", () => {
    expect(attackerBreaksMold({ abilityId: "mold-breaker" })).toBe(true);
    expect(attackerBreaksMold({ ability: "turboblaze" })).toBe(true);
    expect(attackerBreaksMold({ abilityId: "teravolt" })).toBe(true);
    expect(attackerBreaksMold({ abilityId: "intimidate" })).toBe(false);
    expect(attackerBreaksMold({})).toBe(false);
  });

  it("mold-breaker attacker nullifies defensive immunity/defense/sturdy", () => {
    // breakMold=true → immunity/defense mult/sturdy all revert to neutral
    expect(checkAbilityImmunity({ abilityId: "levitate" }, "ground", "physical", true).immune).toBe(false);
    expect(getAbilityDefenseMultiplier({ abilityId: "multiscale" }, "normal", 1, false, true)).toBe(1);
    expect(abilitySurvivesKO({ abilityId: "sturdy" }, true, true)).toBe(false);
  });
});

describe("abilityNullifiesNonSuperEffective (wonder-guard)", () => {
  it("blocks non-super-effective damaging moves, allows super-effective", () => {
    expect(abilityNullifiesNonSuperEffective({ abilityId: "wonder-guard" }, "physical", false)).toBe(true);
    expect(abilityNullifiesNonSuperEffective({ abilityId: "wonder-guard" }, "physical", true)).toBe(false);
  });
  it("never blocks status moves and is neutral for other abilities / mold-breaker", () => {
    expect(abilityNullifiesNonSuperEffective({ abilityId: "wonder-guard" }, "status", false)).toBe(false);
    expect(abilityNullifiesNonSuperEffective({ abilityId: "levitate" }, "physical", false)).toBe(false);
    expect(abilityNullifiesNonSuperEffective({ abilityId: "wonder-guard" }, "physical", false, true)).toBe(false);
    expect(abilityNullifiesNonSuperEffective({}, "physical", false)).toBe(false);
  });
});

describe("abilityBlocksIndirectDamage (magic-guard)", () => {
  it("true only for magic-guard", () => {
    expect(abilityBlocksIndirectDamage({ abilityId: "magic-guard" })).toBe(true);
    expect(abilityBlocksIndirectDamage({ ability: "magic-guard" })).toBe(true);
    expect(abilityBlocksIndirectDamage({ abilityId: "levitate" })).toBe(false);
    expect(abilityBlocksIndirectDamage({})).toBe(false);
  });
});

describe("resolveUnawareStages", () => {
  function stages(overrides?: Partial<StatStages>): StatStages {
    return { ...defaultStatStages(), ...overrides };
  }

  it("returns input references unchanged when neither side is unaware", () => {
    const atk = stages({ attack: 2 });
    const def = stages({ defense: 2 });
    const out = resolveUnawareStages({}, {}, atk, def);
    expect(out.attackerStages).toBe(atk);
    expect(out.defenderStages).toBe(def);
  });

  it("defender unaware → attacker's atk/spAtk stages zeroed (other stages kept)", () => {
    const atk = stages({ attack: 3, spAttack: 2, speed: 1 });
    const out = resolveUnawareStages({}, { abilityId: "unaware" }, atk, stages());
    expect(out.attackerStages).toMatchObject({ attack: 0, spAttack: 0, speed: 1 });
    // 원본은 불변
    expect(atk.attack).toBe(3);
  });

  it("attacker unaware → defender's def/spDef stages zeroed", () => {
    const def = stages({ defense: 3, spDefense: 2, speed: 1 });
    const out = resolveUnawareStages({ abilityId: "unaware" }, {}, stages(), def);
    expect(out.defenderStages).toMatchObject({ defense: 0, spDefense: 0, speed: 1 });
  });
});

describe("applyContraryToChange", () => {
  it("reverses sign only for contrary holders", () => {
    expect(applyContraryToChange({ abilityId: "contrary" }, -1)).toBe(1);
    expect(applyContraryToChange({ abilityId: "contrary" }, 2)).toBe(-2);
    expect(applyContraryToChange({ abilityId: "intimidate" }, -1)).toBe(-1);
    expect(applyContraryToChange({}, -1)).toBe(-1);
  });
});

describe("checkDisguiseBreak (disguise)", () => {
  it("breaks on the first damaging hit and reports maxHp/8 chip", () => {
    const r = checkDisguiseBreak({ abilityId: "disguise" }, "physical", 40, false, 80);
    expect(r.broke).toBe(true);
    expect(r.chipDamage).toBe(10); // 80/8
  });

  it("does not break again once already busted", () => {
    expect(checkDisguiseBreak({ abilityId: "disguise" }, "physical", 40, true, 80).broke).toBe(false);
  });

  it("ignores status moves and zero-damage hits", () => {
    expect(checkDisguiseBreak({ abilityId: "disguise" }, "status", 0, false, 80).broke).toBe(false);
    expect(checkDisguiseBreak({ abilityId: "disguise" }, "physical", 0, false, 80).broke).toBe(false);
  });

  it("is neutral for other abilities and for mold-breaker attackers", () => {
    expect(checkDisguiseBreak({ abilityId: "levitate" }, "physical", 40, false, 80).broke).toBe(false);
    expect(checkDisguiseBreak({}, "physical", 40, false, 80).broke).toBe(false);
    expect(checkDisguiseBreak({ abilityId: "disguise" }, "physical", 40, false, 80, true).broke).toBe(false);
  });

  it("chip damage is at least 1 for tiny maxHp", () => {
    expect(checkDisguiseBreak({ abilityId: "disguise" }, "special", 5, false, 4).chipDamage).toBe(1);
  });
});

// ── Batch 1: 기존 훅에 추가된 특성(호출부 변경 없음) ──────────────────────────
describe("batch1: type-boost offense abilities", () => {
  const frac = 0.5;
  it("steelworker/dragons-maw/rocky-payload ×1.5 on their type", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "steelworker" }, "steel", "physical", 80, frac, false, false)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "dragons-maw" }, "dragon", "special", 80, frac, false, false)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "rocky-payload" }, "rock", "physical", 80, frac, false, false)).toBeCloseTo(1.5);
  });
  it("transistor ×1.3 electric, water-bubble ×2 water", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "transistor" }, "electric", "special", 80, frac, false, false)).toBeCloseTo(1.3);
    expect(getAbilityOffenseMultiplier({ abilityId: "water-bubble" }, "water", "special", 80, frac, false, false)).toBe(2);
  });
  it("gorilla-tactics ×1.5 physical only", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "gorilla-tactics" }, "normal", "physical", 80, frac, false, false)).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "gorilla-tactics" }, "normal", "special", 80, frac, false, false)).toBe(1);
  });
  it("off-type / unknown stays neutral", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "steelworker" }, "fire", "physical", 80, frac, false, false)).toBe(1);
  });
});

describe("batch1: defense reduction abilities", () => {
  it("water-bubble halves fire taken", () => {
    expect(getAbilityDefenseMultiplier({ abilityId: "water-bubble" }, "fire", 1, false)).toBe(0.5);
    expect(getAbilityDefenseMultiplier({ abilityId: "water-bubble" }, "water", 1, false)).toBe(1);
  });
  it("purifying-salt halves ghost taken", () => {
    expect(getAbilityDefenseMultiplier({ abilityId: "purifying-salt" }, "ghost", 1, false)).toBe(0.5);
    expect(getAbilityDefenseMultiplier({ abilityId: "purifying-salt" }, "dark", 1, false)).toBe(1);
  });
});

describe("batch1: immunity abilities", () => {
  it("earth-eater: ground immune + 1/4 heal", () => {
    expect(checkAbilityImmunity({ abilityId: "earth-eater" }, "ground", "physical")).toEqual({ immune: true, healFraction: 1 / 4 });
    expect(checkAbilityImmunity({ abilityId: "earth-eater" }, "rock", "physical").immune).toBe(false);
  });
  it("well-baked-body: fire immune + defense boost", () => {
    expect(checkAbilityImmunity({ abilityId: "well-baked-body" }, "fire", "special")).toEqual({ immune: true, boostStat: "defense" });
    expect(checkAbilityImmunity({ abilityId: "well-baked-body" }, "water", "special").immune).toBe(false);
  });
});

describe("batch1: status-blocking abilities", () => {
  it("sweet-veil blocks sleep, pastel-veil blocks poison", () => {
    expect(abilityBlocksStatus({ abilityId: "sweet-veil" }, "sleep")).toBe(true);
    expect(abilityBlocksStatus({ abilityId: "sweet-veil" }, "burn")).toBe(false);
    expect(abilityBlocksStatus({ abilityId: "pastel-veil" }, "poison")).toBe(true);
  });
  it("thermal-exchange and water-bubble block burn", () => {
    expect(abilityBlocksStatus({ abilityId: "thermal-exchange" }, "burn")).toBe(true);
    expect(abilityBlocksStatus({ abilityId: "water-bubble" }, "burn")).toBe(true);
    expect(abilityBlocksStatus({ abilityId: "water-bubble" }, "paralysis")).toBe(false);
  });
});

// ── Batch 2: 기술 플래그 기반 위력 특성(buildOffenseContext ctx 경유) ──────────
describe("batch2: move-flag offense abilities", () => {
  const frac = 0.5;
  it("move-flag predicates classify correctly", () => {
    expect(isSlicingMove("leaf-blade")).toBe(true);
    expect(isSlicingMove("tackle")).toBe(false);
    expect(isBitingMove("crunch")).toBe(true);
    expect(isPulseMove("aura-sphere")).toBe(true);
    expect(isSoundMove("boomburst")).toBe(true);
  });
  it("sharpness ×1.5 only for slicing moves", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "sharpness" }, "grass", "physical", 90, frac, false, false, { isSlicing: true })).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "sharpness" }, "grass", "physical", 90, frac, false, false, {})).toBe(1);
  });
  it("strong-jaw ×1.5 biting, mega-launcher ×1.5 pulse, punk-rock ×1.3 sound", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "strong-jaw" }, "dark", "physical", 80, frac, false, false, { isBiting: true })).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "mega-launcher" }, "fighting", "special", 80, frac, false, false, { isPulse: true })).toBeCloseTo(1.5);
    expect(getAbilityOffenseMultiplier({ abilityId: "punk-rock" }, "normal", "special", 90, frac, false, false, { isSound: true })).toBeCloseTo(1.3);
  });
  it("status-category move gets no flag boost (isDamaging gate)", () => {
    expect(getAbilityOffenseMultiplier({ abilityId: "punk-rock" }, "normal", "status", 0, frac, false, false, { isSound: true })).toBe(1);
  });
});

// ── Batch 3: 격파(on-KO) 시 공격자 스탯 상승 ─────────────────────────────────
describe("batch3: getKnockoutBoost", () => {
  it("moxie/chilling-neigh raise attack, grim-neigh/soul-heart raise spAttack", () => {
    expect(getKnockoutBoost({ abilityId: "moxie" })).toEqual({ stat: "attack", amount: 1 });
    expect(getKnockoutBoost({ abilityId: "chilling-neigh" })).toEqual({ stat: "attack", amount: 1 });
    expect(getKnockoutBoost({ abilityId: "grim-neigh" })).toEqual({ stat: "spAttack", amount: 1 });
    expect(getKnockoutBoost({ abilityId: "soul-heart" })).toEqual({ stat: "spAttack", amount: 1 });
  });
  it("beast-boost picks the highest of the 5 stats", () => {
    const stats = { attack: 60, defense: 40, spAttack: 120, spDefense: 50, speed: 100 };
    expect(getKnockoutBoost({ abilityId: "beast-boost" }, stats)).toEqual({ stat: "spAttack", amount: 1 });
    const fast = { attack: 90, defense: 40, spAttack: 50, spDefense: 50, speed: 130 };
    expect(getKnockoutBoost({ abilityId: "beast-boost" }, fast)).toEqual({ stat: "speed", amount: 1 });
  });
  it("null for non-KO abilities", () => {
    expect(getKnockoutBoost({ abilityId: "intimidate" })).toBeNull();
    expect(getKnockoutBoost({})).toBeNull();
  });
});
