import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateDamage, determineTurnOrder, rollCritical, CRIT_MULTIPLIER } from "../../src/game/battle.js";
import type { PokemonStats, MoveData } from "../../../../shared/types.js";

describe("calculateDamage", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("calculates physical damage with neutral effectiveness", () => {
    // random() call 1: accuracy check (hit if < accuracy/100) → 0.5 (hit for accuracy 100)
    // random() call 2: randomFactor → 0.0 (gives 0.85)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);

    expect(result.missed).toBe(false);
    expect(result.damage).toBe(10); // STAB 1.5x: normal move + normal attacker
    expect(result.effectiveness).toBe(1.0);
  });

  it("calculates super effective damage (fire vs grass = 2.0)", () => {
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 60, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "ember",
      name: "불꽃세례",
      type: "fire",
      category: "special",
      power: 40,
      accuracy: 100,
      pp: 25,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["fire"], ["grass"]);

    expect(result.missed).toBe(false);
    expect(result.damage).toBe(23); // STAB 1.5x: fire move + fire attacker
    expect(result.effectiveness).toBe(2.0);
    expect(result.message).toBe("효과가 굉장했다!");
  });

  it("calculates not very effective damage (fire vs water = 0.5)", () => {
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 60, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "ember",
      name: "불꽃세례",
      type: "fire",
      category: "special",
      power: 40,
      accuracy: 100,
      pp: 25,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["fire"], ["water"]);

    expect(result.missed).toBe(false);
    expect(result.damage).toBe(5); // STAB 1.5x: fire move + fire attacker
    expect(result.effectiveness).toBe(0.5);
    expect(result.message).toBe("효과가 별로인 듯하다...");
  });

  it("calculates no effect (electric vs ground = 0)", () => {
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 60, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "thunder-shock",
      name: "전기쇼크",
      type: "electric",
      category: "special",
      power: 40,
      accuracy: 100,
      pp: 30,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["electric"], ["ground"]);

    expect(result.missed).toBe(false);
    expect(result.damage).toBe(0);
    expect(result.effectiveness).toBe(0);
    expect(result.message).toBe("효과가 없는 것 같다...");
  });

  it("misses when accuracy roll fails (positive accuracy)", () => {
    // accuracy 70 기술에 roll 80(=0.8*100) → 80 >= 70 이라 빗나감.
    randomSpy.mockReturnValueOnce(0.8);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "test-miss",
      name: "test",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 70,
      pp: 10,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);

    expect(result.missed).toBe(true);
    expect(result.damage).toBe(0);
  });

  it("always hits when accuracy is 0 (본가 '—' 표기 = 필중)", () => {
    // accuracy 0/null은 필중. 명중 굴림 없이 반드시 명중하고, 이후 난수는 급소·난수보정용.
    randomSpy.mockReturnValue(0.5);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "test-sureshot",
      name: "test",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 0,
      pp: 10,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);

    expect(result.missed).toBe(false);
    expect(result.damage).toBeGreaterThan(0);
  });

  it("returns 0 damage for status moves (power 0)", () => {
    randomSpy.mockReturnValueOnce(0.1);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "growl",
      name: "울음소리",
      type: "normal",
      category: "status" as "physical",
      power: 0,
      accuracy: 100,
      pp: 40,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);

    expect(result.damage).toBe(0);
  });

  it("applies critical hit multiplier", () => {
    // Non-crit run: accuracy hit, crit miss (0.5*24=12>=1), randomFactor 0.0
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };

    const noCrit = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);
    expect(noCrit.critical).toBe(false);

    // Crit run: accuracy hit, crit hit (0.0*24=0<1), randomFactor 0.0
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0).mockReturnValueOnce(0.0);
    const withCrit = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);
    expect(withCrit.critical).toBe(true);
    expect(withCrit.damage).toBe(Math.floor(noCrit.damage * 1.5));
  });

  it("critical hit ignores negative attacker stages", () => {
    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };

    // Non-crit with -2 attack stage: accuracy, no crit, randomFactor
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);
    const noCritDebuffed = calculateDamage(
      10, attackerStats, defenderStats, move, ["normal"], ["normal"],
      { attack: -2, defense: 0, spAttack: 0, spDefense: 0, speed: 0 },
    );

    // Crit with -2 attack stage: should ignore the -2 and use 0
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0).mockReturnValueOnce(0.0);
    const critDebuffed = calculateDamage(
      10, attackerStats, defenderStats, move, ["normal"], ["normal"],
      { attack: -2, defense: 0, spAttack: 0, spDefense: 0, speed: 0 },
    );

    // Crit with no stage debuff (baseline)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0).mockReturnValueOnce(0.0);
    const critNoDebuff = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);

    expect(critDebuffed.critical).toBe(true);
    // Crit should ignore -2 attack, so damage equals crit with stage 0
    expect(critDebuffed.damage).toBe(critNoDebuff.damage);
    // And crit-debuffed should be much higher than non-crit-debuffed
    expect(critDebuffed.damage).toBeGreaterThan(noCritDebuffed.damage);
  });

  it("critical hit ignores positive defender stages", () => {
    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };

    // Non-crit with +2 defense stage on defender
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);
    const noCritBuffed = calculateDamage(
      10, attackerStats, defenderStats, move, ["normal"], ["normal"],
      undefined,
      { attack: 0, defense: 2, spAttack: 0, spDefense: 0, speed: 0 },
    );

    // Crit with +2 defense stage on defender: should ignore the +2
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0).mockReturnValueOnce(0.0);
    const critBuffed = calculateDamage(
      10, attackerStats, defenderStats, move, ["normal"], ["normal"],
      undefined,
      { attack: 0, defense: 2, spAttack: 0, spDefense: 0, speed: 0 },
    );

    // Crit with no defense buff (baseline)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0).mockReturnValueOnce(0.0);
    const critNoBuff = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);

    expect(critBuffed.critical).toBe(true);
    // Crit should ignore +2 defense, so damage equals crit with stage 0
    expect(critBuffed.damage).toBe(critNoBuff.damage);
    // And crit-buffed should be much higher than non-crit-buffed
    expect(critBuffed.damage).toBeGreaterThan(noCritBuffed.damage);
  });

  it("no critical hit when critRate is 0 and roll is high", () => {
    // accuracy hit, crit roll high (0.9*24=21.6>=1 → no crit), randomFactor 0.0
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.9).mockReturnValueOnce(0.0);

    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const move: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };

    const result = calculateDamage(10, attackerStats, defenderStats, move, ["normal"], ["normal"]);
    expect(result.critical).toBe(false);
  });

  it("DamageResult includes critical field", () => {
    // Test miss case
    randomSpy.mockReturnValueOnce(0.5);
    const attackerStats: PokemonStats = { attack: 50, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };
    const defenderStats: PokemonStats = { attack: 40, defense: 40, speed: 30, spAttack: 40, spDefense: 40 };

    const missMove: MoveData = {
      id: "test-miss",
      name: "test",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 0,
      pp: 10,
      description: "",
    };
    const missResult = calculateDamage(10, attackerStats, defenderStats, missMove, ["normal"], ["normal"]);
    expect(missResult).toHaveProperty("critical");
    expect(missResult.critical).toBe(false);

    // Test hit case (no crit)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.5).mockReturnValueOnce(0.0);
    const hitMove: MoveData = {
      id: "tackle",
      name: "몸통박치기",
      type: "normal",
      category: "physical",
      power: 40,
      accuracy: 100,
      pp: 35,
      description: "",
    };
    const hitResult = calculateDamage(10, attackerStats, defenderStats, hitMove, ["normal"], ["normal"]);
    expect(hitResult).toHaveProperty("critical");
    expect(hitResult.critical).toBe(false);

    // Test hit case (with crit)
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.0).mockReturnValueOnce(0.0);
    const critResult = calculateDamage(10, attackerStats, defenderStats, hitMove, ["normal"], ["normal"]);
    expect(critResult).toHaveProperty("critical");
    expect(critResult.critical).toBe(true);
  });
});

describe("rollCritical", () => {
  // 본가 Gen6+ 급소 확률표: stage 0=1/24, 1=1/8, 2=1/2, 3 이상=필중.
  // random()*denominator < 1 일 때 급소. 경계 굴림을 주입해 표를 검증한다.

  it("CRIT_MULTIPLIER is 1.5", () => {
    expect(CRIT_MULTIPLIER).toBe(1.5);
  });

  it("stage 0 → 1/24 (denominator 24)", () => {
    // 0.0 → 0 < 1 급소; 1/24 직전(<1/24)도 급소; 1/24 이상은 비급소.
    expect(rollCritical(0, () => 0.0)).toBe(true);
    expect(rollCritical(0, () => 0.5 / 24)).toBe(true); // 0.5 < 1 → 급소
    expect(rollCritical(0, () => 1 / 24)).toBe(false); // 1*24/24 = 1, 1 < 1 거짓
    expect(rollCritical(0, () => 0.99)).toBe(false);
  });

  it("stage 1 → 1/8 (denominator 8)", () => {
    expect(rollCritical(1, () => 0.0)).toBe(true);
    expect(rollCritical(1, () => 0.5 / 8)).toBe(true); // 0.5 < 1
    expect(rollCritical(1, () => 1 / 8)).toBe(false); // 1 < 1 거짓
    expect(rollCritical(1, () => 0.5)).toBe(false); // 4 < 1 거짓
  });

  it("stage 2 → 1/2 (denominator 2)", () => {
    expect(rollCritical(2, () => 0.0)).toBe(true);
    expect(rollCritical(2, () => 0.49)).toBe(true); // 0.98 < 1
    expect(rollCritical(2, () => 0.5)).toBe(false); // 1 < 1 거짓
    expect(rollCritical(2, () => 0.99)).toBe(false);
  });

  it("stage 3 이상 → 항상 급소 (denominator 1)", () => {
    expect(rollCritical(3, () => 0.99)).toBe(true); // 0.99 < 1
    expect(rollCritical(3, () => 0.0)).toBe(true);
    expect(rollCritical(5, () => 0.99)).toBe(true); // 3 초과도 1/1로 클램프
  });

  it("음수 critRate는 0단계로 클램프", () => {
    expect(rollCritical(-1, () => 1 / 24)).toBe(false);
    expect(rollCritical(-1, () => 0.0)).toBe(true);
  });

  it("기본 random은 Math.random (인자 생략 시 동작)", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.0);
    expect(rollCritical(0)).toBe(true);
    spy.mockReturnValue(0.99);
    expect(rollCritical(0)).toBe(false);
    spy.mockRestore();
  });
});

describe("determineTurnOrder", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("player goes first when faster", () => {
    expect(determineTurnOrder(60, 40)).toBe("player");
  });

  it("wild goes first when faster", () => {
    expect(determineTurnOrder(40, 60)).toBe("wild");
  });

  it("random on tie - player first when random < 0.5", () => {
    randomSpy.mockReturnValueOnce(0.3);
    expect(determineTurnOrder(50, 50)).toBe("player");
  });

  it("random on tie - wild first when random >= 0.5", () => {
    randomSpy.mockReturnValueOnce(0.7);
    expect(determineTurnOrder(50, 50)).toBe("wild");
  });

  it("higher priority goes first regardless of speed", () => {
    // 플레이어가 느리지만 priority가 높으면 선공
    expect(determineTurnOrder(30, 100, 1, 0)).toBe("player");
    // 야생이 느리지만 priority가 높으면 야생 선공
    expect(determineTurnOrder(100, 30, 0, 1)).toBe("wild");
  });

  it("same priority falls back to speed", () => {
    expect(determineTurnOrder(80, 50, 0, 0)).toBe("player");
    expect(determineTurnOrder(50, 80, 1, 1)).toBe("wild");
  });

  it("negative priority goes last", () => {
    // 플레이어가 빠르지만 priority -1이면 야생 선공
    expect(determineTurnOrder(100, 30, -1, 0)).toBe("wild");
  });
});
