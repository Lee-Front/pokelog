import { describe, expect, it } from "vitest";
import {
  checkLevelUp,
  getExpForLevelInGroup,
  getSpeciesExpGroup,
} from "../../src/game/growth.js";
import { normalizeOwnedPokemon } from "../../src/storage/user-store.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

function createOwnedPokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "test-uid",
    species: "growlithe",
    nickname: null,
    level: 20,
    exp: 0,
    hp: 40,
    maxHp: 40,
    stats: { attack: 30, defense: 25, speed: 28, spAttack: 27, spDefense: 26 },
    // IV가 있으면 normalize가 스탯을 재계산하지 않고 그대로 보존한다(클램프 검증에 방해 없음).
    ivs: { hp: 15, attack: 15, defense: 15, spAttack: 15, spDefense: 15, speed: 15 },
    moves: [{ id: "ember", pp: 25, maxPp: 25 }],
    caughtAt: "2024-01-01T00:00:00Z",
    gender: null,
    friendship: 70,
    heldItem: null,
    abilityId: null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: "hardy",
    ...overrides,
  };
}

describe("getExpForLevelInGroup — 본가 성장곡선 실측값", () => {
  it("모든 그룹은 레벨 1에서 0을 반환한다", () => {
    for (const group of [
      "medium",
      "fast",
      "slow",
      "medium-slow",
      "slow-then-very-fast",
      "fast-then-very-slow",
    ]) {
      expect(getExpForLevelInGroup(group, 1)).toBe(0);
      // 레벨 0/음수도 0.
      expect(getExpForLevelInGroup(group, 0)).toBe(0);
    }
  });

  it("레벨 100 누적 EXP가 본가 실측값과 일치한다", () => {
    expect(getExpForLevelInGroup("medium", 100)).toBe(1_000_000);
    expect(getExpForLevelInGroup("fast", 100)).toBe(800_000);
    expect(getExpForLevelInGroup("slow", 100)).toBe(1_250_000);
    expect(getExpForLevelInGroup("medium-slow", 100)).toBe(1_059_860);
    expect(getExpForLevelInGroup("slow-then-very-fast", 100)).toBe(600_000); // Erratic
    expect(getExpForLevelInGroup("fast-then-very-slow", 100)).toBe(1_640_000); // Fluctuating
  });

  it("Erratic(slow-then-very-fast)의 구간 경계값을 정확히 계산한다", () => {
    expect(getExpForLevelInGroup("slow-then-very-fast", 50)).toBe(125_000);
    expect(getExpForLevelInGroup("slow-then-very-fast", 51)).toBe(131_324);
    expect(getExpForLevelInGroup("slow-then-very-fast", 68)).toBe(257_834);
    expect(getExpForLevelInGroup("slow-then-very-fast", 69)).toBe(267_406);
    expect(getExpForLevelInGroup("slow-then-very-fast", 98)).toBe(583_539);
    expect(getExpForLevelInGroup("slow-then-very-fast", 99)).toBe(591_882);
  });

  it("Fluctuating(fast-then-very-slow)의 구간 경계값을 정확히 계산한다", () => {
    expect(getExpForLevelInGroup("fast-then-very-slow", 15)).toBe(1_957);
    expect(getExpForLevelInGroup("fast-then-very-slow", 16)).toBe(2_457);
    expect(getExpForLevelInGroup("fast-then-very-slow", 36)).toBe(46_656);
    expect(getExpForLevelInGroup("fast-then-very-slow", 37)).toBe(50_653);
  });

  it("알 수 없는/누락 그룹은 medium(n³)으로 폴백한다", () => {
    expect(getExpForLevelInGroup("nonsense", 50)).toBe(50 ** 3);
    expect(getExpForLevelInGroup("", 30)).toBe(30 ** 3);
  });

  it("getSpeciesExpGroup은 species.json의 expGroup을 돌려준다(미상은 medium 폴백)", () => {
    expect(getSpeciesExpGroup("growlithe")).toBe("slow");
    expect(getSpeciesExpGroup("clefairy")).toBe("fast");
    expect(getSpeciesExpGroup("bulbasaur")).toBe("medium-slow");
    expect(getSpeciesExpGroup("no-such-species")).toBe("medium");
  });
});

describe("normalizeOwnedPokemon — 성장곡선 변경 마이그레이션(위로만 클램프)", () => {
  it("slow종의 저장 exp가 현재 레벨 임계치 아래면 임계치로 끌어올린다(레벨 불변)", () => {
    // growlithe = slow. 예전 세제곱 곡선으론 L20 = 8000이지만 slow 곡선 L20 = 10000이다.
    // 저장 exp 8000은 새 임계치 아래 → 10000으로 클램프. 레벨은 20 그대로.
    const floor = getExpForLevelInGroup("slow", 20);
    expect(floor).toBe(10_000);

    const normalized = normalizeOwnedPokemon(createOwnedPokemon({ level: 20, exp: 8_000 }));
    expect(normalized.level).toBe(20);
    expect(normalized.exp).toBe(floor);
  });

  it("임계치를 넘는 exp는 그대로 보존한다(아래로 깎지 않음)", () => {
    // slow L20 = 10000, L21 = 11576. 11000은 임계치 초과이나 다음 레벨엔 못 미친다 →
    // 값 보존, 레벨도 20 유지(normalize는 레벨업을 수행하지 않는다).
    const normalized = normalizeOwnedPokemon(createOwnedPokemon({ level: 20, exp: 11_000 }));
    expect(normalized.level).toBe(20);
    expect(normalized.exp).toBe(11_000);
  });
});

describe("checkLevelUp — 종별 성장곡선을 따른다", () => {
  it("fast종은 fast 곡선 임계치에서 레벨업한다(세제곱 아님)", () => {
    // clefairy = fast. fast L11 = 1064 (세제곱 곡선이라면 1331). 정확히 임계치면 레벨업.
    const threshold = getExpForLevelInGroup("fast", 11);
    expect(threshold).toBe(1_064);

    const leveled = checkLevelUp(createOwnedPokemon({ species: "clefairy", level: 10, exp: threshold }));
    expect(leveled.leveled).toBe(true);
    expect(leveled.newLevel).toBe(11);

    // 임계치보다 1 적으면 레벨업하지 않는다.
    const notLeveled = checkLevelUp(createOwnedPokemon({ species: "clefairy", level: 10, exp: threshold - 1 }));
    expect(notLeveled.leveled).toBe(false);
    expect(notLeveled.newLevel).toBe(10);
  });

  it("현재 레벨 임계치 아래 exp는 checkLevelUp이 방어적으로 끌어올린다(레벨 불변)", () => {
    // slow종을 세제곱 곡선 값(8000)으로 저장한 개체 — checkLevelUp 진입 시 slow L20(10000)로
    // 클램프되지만, 그 값으론 L21(11576)에 못 미쳐 레벨업하지 않는다.
    const mon = createOwnedPokemon({ species: "growlithe", level: 20, exp: 8_000 });
    const result = checkLevelUp(mon);
    expect(result.leveled).toBe(false);
    expect(result.newLevel).toBe(20);
    expect(mon.exp).toBe(getExpForLevelInGroup("slow", 20));
  });
});
