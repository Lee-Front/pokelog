import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateDamage,
  accuracyStageMultiplier,
  defaultStatStages,
} from "../../src/game/battle.js";
import type { MoveData, PokemonStats, StatStages } from "../../../../shared/types.js";

const STATS: PokemonStats = { attack: 100, defense: 100, speed: 100, spAttack: 100, spDefense: 100 };

function move(accuracy: number): MoveData {
  return {
    id: "tackle",
    name: "몸통박치기",
    type: "normal",
    category: "physical",
    power: 40,
    accuracy,
    pp: 35,
    priority: 0,
    target: "selected-pokemon",
    meta: {},
    statChanges: [],
  } as unknown as MoveData;
}

afterEach(() => vi.restoreAllMocks());

describe("명중 단계(accuracy/evasion)", () => {
  it("단계 배율이 본가 3기반 표와 일치", () => {
    expect(accuracyStageMultiplier(0)).toBeCloseTo(1);
    expect(accuracyStageMultiplier(1)).toBeCloseTo(4 / 3);
    expect(accuracyStageMultiplier(3)).toBeCloseTo(2);
    expect(accuracyStageMultiplier(6)).toBeCloseTo(3);
    expect(accuracyStageMultiplier(-1)).toBeCloseTo(2 / 3);
    expect(accuracyStageMultiplier(-2)).toBeCloseTo(2 / 4);
    expect(accuracyStageMultiplier(-6)).toBeCloseTo(2 / 8);
  });

  it("보정 없으면 100명중 기술은 절대 안 빗나간다", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const r = calculateDamage(50, STATS, STATS, move(100), ["normal"], ["normal"], defaultStatStages(), defaultStatStages());
    expect(r.missed).toBe(false);
  });

  it("상대 회피 +6이면 100명중 기술도 빗나갈 수 있다(유효 25)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // roll 50 >= 25 → miss
    const def: StatStages = { ...defaultStatStages(), evasion: 6 };
    const r = calculateDamage(50, STATS, STATS, move(100), ["normal"], ["normal"], defaultStatStages(), def);
    expect(r.missed).toBe(true);
  });

  it("사용자 명중 하락(모래뿌리기류 −2)이면 명중이 떨어진다(유효 50)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.7); // roll 70 >= 50 → miss
    const atk: StatStages = { ...defaultStatStages(), accuracy: -2 };
    const r = calculateDamage(50, STATS, STATS, move(100), ["normal"], ["normal"], atk, defaultStatStages());
    expect(r.missed).toBe(true);
  });

  it("명중 단계가 회피를 상쇄하면 다시 명중한다", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // roll 50; combined 0 → 유효 100 → hit
    const atk: StatStages = { ...defaultStatStages(), accuracy: 6 };
    const def: StatStages = { ...defaultStatStages(), evasion: 6 };
    const r = calculateDamage(50, STATS, STATS, move(100), ["normal"], ["normal"], atk, def);
    expect(r.missed).toBe(false);
  });
});
