import { describe, expect, it } from "vitest";
import {
  applyEvGain,
  emptyEvs,
  evContribution,
  getEvYield,
  EV_STAT_MAX,
  EV_TOTAL_MAX,
  VITAMIN_STAT,
} from "../../src/game/evs.js";

describe("applyEvGain", () => {
  it("adds the gain to a fresh EV object", () => {
    const result = applyEvGain(emptyEvs(), { attack: 10 });
    expect(result.attack).toBe(10);
    expect(result.hp).toBe(0);
  });

  it("clamps a single stat at 252", () => {
    const result = applyEvGain({ ...emptyEvs(), attack: 250 }, { attack: 10 });
    expect(result.attack).toBe(EV_STAT_MAX);
  });

  it("respects the 510 total cap, consuming the budget in canonical key order", () => {
    // hp=252, attack=252 → total 504, only 6 budget left → goes to defense.
    const start = { ...emptyEvs(), hp: 252, attack: 252 };
    const result = applyEvGain(start, { defense: 100 });
    expect(result.defense).toBe(EV_TOTAL_MAX - 504); // 6
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    expect(total).toBe(EV_TOTAL_MAX);
  });

  it("pokérus doubling (2× yield) still obeys caps", () => {
    // 1배 수확 yield를 2배로 부풀려 넣어도 applyEvGain이 252/510을 강제한다.
    const base = getEvYield("pidgey"); // speed 1 (실측표)
    const doubled = Object.fromEntries(
      Object.entries(base).map(([k, v]) => [k, (v ?? 0) * 2]),
    );
    const result = applyEvGain(emptyEvs(), doubled);
    const total = Object.values(result).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(EV_TOTAL_MAX);
    // 2배여도 각 스탯은 ≤252.
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      expect(result[key]).toBeLessThanOrEqual(EV_STAT_MAX);
    }
  });
});

describe("evContribution", () => {
  it("is floor(ev / 4)", () => {
    expect(evContribution(0)).toBe(0);
    expect(evContribution(7)).toBe(1);
    expect(evContribution(252)).toBe(63);
  });
});

describe("VITAMIN_STAT", () => {
  it("maps every vitamin id to a distinct EV stat key", () => {
    expect(VITAMIN_STAT).toEqual({
      protein: "attack",
      calcium: "spAttack",
      iron: "defense",
      zinc: "spDefense",
      carbos: "speed",
      "hp-up": "hp",
    });
  });
});
