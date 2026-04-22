import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  attemptCapture,
  calculateCaptureChance,
  getCatchRate,
  getStatusCaptureBonus,
} from "../../src/game/capture.js";

describe("calculateCaptureChance", () => {
  it("pokeball(1.0) + HP 100% + catchRate 0.3 = 0.3", () => {
    // chance = min(1.0, 1.0 * (1 - 100/100) * 0.5 + 0.3) = min(1.0, 0 + 0.3) = 0.3
    const chance = calculateCaptureChance(1.0, 100, 100, 0.3);
    expect(chance).toBeCloseTo(0.3);
  });

  it("hyperball(2.0) + HP 10% + catchRate 0.3 = 1.0 (clamped)", () => {
    // chance = min(1.0, 2.0 * (1 - 10/100) * 0.5 + 0.3) = min(1.0, 2.0 * 0.9 * 0.5 + 0.3) = min(1.0, 0.9 + 0.3) = 1.0
    const chance = calculateCaptureChance(2.0, 10, 100, 0.3);
    expect(chance).toBeCloseTo(1.0);
  });

  it("pokeball(1.0) + HP 30% + catchRate 0.3 = 0.65", () => {
    // chance = min(1.0, 1.0 * (1 - 30/100) * 0.5 + 0.3) = min(1.0, 0.7 * 0.5 + 0.3) = min(1.0, 0.35 + 0.3) = 0.65
    const chance = calculateCaptureChance(1.0, 30, 100, 0.3);
    expect(chance).toBeCloseTo(0.65);
  });

  it("result never exceeds 1.0", () => {
    const chance = calculateCaptureChance(3.0, 5, 100, 0.8);
    expect(chance).toBeLessThanOrEqual(1.0);
  });

  it("handles zero maxHp without NaN", () => {
    expect(Number.isFinite(calculateCaptureChance(1.0, 0, 0, 0.5))).toBe(true);
  });
});

describe("attemptCapture", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("captures when random < chance", () => {
    randomSpy.mockReturnValueOnce(0.1);
    expect(attemptCapture(1.0, 30, 100, 0.3)).toBe(true);
  });

  it("fails when random >= chance", () => {
    randomSpy.mockReturnValueOnce(0.99);
    expect(attemptCapture(1.0, 100, 100, 0.3)).toBe(false);
  });
});

describe("getStatusCaptureBonus", () => {
  it("returns 2.5x for sleep/freeze", () => {
    expect(getStatusCaptureBonus("sleep")).toBe(2.5);
    expect(getStatusCaptureBonus("freeze")).toBe(2.5);
  });

  it("returns 1.5x for paralysis/poison/burn", () => {
    expect(getStatusCaptureBonus("paralysis")).toBe(1.5);
    expect(getStatusCaptureBonus("poison")).toBe(1.5);
    expect(getStatusCaptureBonus("burn")).toBe(1.5);
  });

  it("returns 1.0x for null/undefined", () => {
    expect(getStatusCaptureBonus(null)).toBe(1.0);
    expect(getStatusCaptureBonus(undefined)).toBe(1.0);
  });
});

describe("calculateCaptureChance with status bonus", () => {
  it("sleep more than doubles a weak baseline catch", () => {
    const healthy = calculateCaptureChance(1.0, 100, 100, 0.3, null);
    const asleep = calculateCaptureChance(1.0, 100, 100, 0.3, "sleep");
    expect(asleep).toBeCloseTo(Math.min(1.0, healthy * 2.5));
    expect(asleep).toBeGreaterThan(healthy);
  });

  it("paralysis/poison/burn give a moderate 1.5x bonus", () => {
    const healthy = calculateCaptureChance(1.0, 100, 100, 0.2, null);
    const paralyzed = calculateCaptureChance(1.0, 100, 100, 0.2, "paralysis");
    const poisoned = calculateCaptureChance(1.0, 100, 100, 0.2, "poison");
    const burned = calculateCaptureChance(1.0, 100, 100, 0.2, "burn");
    expect(paralyzed).toBeCloseTo(Math.min(1.0, healthy * 1.5));
    expect(poisoned).toBeCloseTo(Math.min(1.0, healthy * 1.5));
    expect(burned).toBeCloseTo(Math.min(1.0, healthy * 1.5));
  });

  it("no status preserves the baseline formula", () => {
    // baseline: 1.0 * (1 - 30/100) * 0.5 + 0.3 = 0.35 + 0.3 = 0.65
    const chance = calculateCaptureChance(1.0, 30, 100, 0.3, null);
    expect(chance).toBeCloseTo(0.65);
  });

  it("clamps result to 1.0 even with status bonus", () => {
    const chance = calculateCaptureChance(2.0, 10, 100, 0.3, "sleep");
    expect(chance).toBeLessThanOrEqual(1.0);
  });
});

describe("attemptCapture with status bonus", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, "random");
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  it("asleep pokemon catches at rolls that would fail for a healthy one", () => {
    // Healthy chance: 1.0 * (1 - 100/100) * 0.5 + 0.1 = 0.1
    // Sleep chance: 0.1 * 2.5 = 0.25
    // Roll 0.2 — fails for healthy (0.2 >= 0.1), succeeds for sleep (0.2 < 0.25)
    randomSpy.mockReturnValue(0.2);
    expect(attemptCapture(1.0, 100, 100, 0.1, null)).toBe(false);
    expect(attemptCapture(1.0, 100, 100, 0.1, "sleep")).toBe(true);
  });
});

describe("getCatchRate", () => {
  it("returns catch rate for known species", () => {
    const rate = getCatchRate("bulbasaur");
    expect(rate).toBeCloseTo(45 / 255);
  });

  it("returns default 0.1 for unknown species", () => {
    const rate = getCatchRate("unknown_pokemon");
    expect(rate).toBe(0.1);
  });
});
