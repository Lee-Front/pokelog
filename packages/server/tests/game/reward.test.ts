import { describe, it, expect } from "vitest";
import { calculateReward } from "../../src/game/reward.js";

describe("calculateReward", () => {
  const config = { expPerByte: 0.5, pointsPerByte: 0.1 };

  it("calculates exp and points from bytes", () => {
    const result = calculateReward(100, 1, config);
    expect(result.exp).toBe(50);    // floor(100 * 0.5 * 1)
    expect(result.points).toBe(10); // floor(100 * 0.1 * 1)
  });

  it("applies combo multiplier", () => {
    const result = calculateReward(100, 2.5, config);
    expect(result.exp).toBe(125);   // floor(100 * 0.5 * 2.5)
    expect(result.points).toBe(25); // floor(100 * 0.1 * 2.5)
  });

  it("floors fractional results", () => {
    const result = calculateReward(33, 1, config);
    expect(result.exp).toBe(16);    // floor(33 * 0.5 * 1) = floor(16.5)
    expect(result.points).toBe(3);  // floor(33 * 0.1 * 1) = floor(3.3)
  });

  it("returns zero for zero bytes", () => {
    const result = calculateReward(0, 2, config);
    expect(result.exp).toBe(0);
    expect(result.points).toBe(0);
  });
});
