import { describe, it, expect } from "vitest";
import { judgeCombo, getComboMultiplier } from "../../src/game/combo.js";
import type { UserCombo, ComboConfig } from "../../../../shared/types.js";

describe("judgeCombo", () => {
  const config: ComboConfig = {
    bytesPerMinute: 10,
    multipliers: [1, 1, 1.5, 2, 2.5],
    maxMultiplier: 3,
  };

  it("returns count 1 for first commit (null combo)", () => {
    const result = judgeCombo(null, 500, "2026-03-23T12:00:00Z", config);
    expect(result.count).toBe(1);
    expect(result.lastCommitAt).toBe("2026-03-23T12:00:00Z");
  });

  it("increments count when density is high enough", () => {
    const prev: UserCombo = { count: 2, lastCommitAt: "2026-03-23T12:00:00Z" };
    // 10 minutes later, 200 bytes => density = 200/10 = 20 >= 10
    const result = judgeCombo(prev, 200, "2026-03-23T12:10:00Z", config);
    expect(result.count).toBe(3);
    expect(result.lastCommitAt).toBe("2026-03-23T12:10:00Z");
  });

  it("resets count to 1 when density is too low", () => {
    const prev: UserCombo = { count: 3, lastCommitAt: "2026-03-23T12:00:00Z" };
    // 60 minutes later, 100 bytes => density = 100/60 ~= 1.67 < 10
    const result = judgeCombo(prev, 100, "2026-03-23T13:00:00Z", config);
    expect(result.count).toBe(1);
    expect(result.lastCommitAt).toBe("2026-03-23T13:00:00Z");
  });

  it("handles zero time difference (same timestamp) as high density", () => {
    const prev: UserCombo = { count: 1, lastCommitAt: "2026-03-23T12:00:00Z" };
    // 0 minutes later, any bytes => density = Infinity >= 10
    const result = judgeCombo(prev, 50, "2026-03-23T12:00:00Z", config);
    expect(result.count).toBe(2);
  });
});

describe("getComboMultiplier", () => {
  const config: ComboConfig = {
    bytesPerMinute: 10,
    multipliers: [1, 1, 1.5, 2, 2.5],
    maxMultiplier: 3,
  };

  it("returns multiplier from array for valid count", () => {
    expect(getComboMultiplier(1, config)).toBe(1);
    expect(getComboMultiplier(2, config)).toBe(1.5);
    expect(getComboMultiplier(3, config)).toBe(2);
    expect(getComboMultiplier(4, config)).toBe(2.5);
  });

  it("returns maxMultiplier when count exceeds array length", () => {
    expect(getComboMultiplier(5, config)).toBe(3);
    expect(getComboMultiplier(10, config)).toBe(3);
  });

  it("returns maxMultiplier when count equals array length", () => {
    // multipliers has indices 0-4, count=5 means index 5 which is out of bounds
    expect(getComboMultiplier(5, config)).toBe(3);
  });
});
