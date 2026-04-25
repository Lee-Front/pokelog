/**
 * Scenario 30 — Battle Form Auto-Change.
 *
 * Drives the form-change predicates directly (battle-forms.ts) — the
 * orchestration code that wires these into the PvP turn loop is the
 * subject of dedicated unit tests; here we just pin the trigger
 * conditions:
 *  - Aegislash physical/special move → blade
 *  - Aegislash status move → revert to shield
 *  - Morpeko alternates each turn
 *  - Castform changes form per weather
 *  - Darmanitan-zen below 50% HP
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import {
  checkPostAttackForm,
  checkHpThresholdForm,
  checkTurnForm,
  checkWeatherForm,
} from "../../src/game/battle-forms.js";

describe("Scenario 30 — Battle Form Auto-Change", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("Aegislash: physical move → blade form", () => {
    const result = checkPostAttackForm("aegislash", "physical", null);
    expect(result?.newForm).toBe("aegislash-blade");
  });

  it("Aegislash: special move → blade form", () => {
    const result = checkPostAttackForm("aegislash", "special", null);
    expect(result?.newForm).toBe("aegislash-blade");
  });

  it("Aegislash: status move while in blade → revert to shield", () => {
    const result = checkPostAttackForm("aegislash", "status", "aegislash-blade");
    expect(result?.newForm).toBeNull(); // null = base/shield
  });

  it("Aegislash: status move while already shield → no change", () => {
    const result = checkPostAttackForm("aegislash", "status", null);
    expect(result).toBeNull();
  });

  it("Morpeko: odd turn → hangry, even turn → full-belly", () => {
    expect(checkTurnForm("morpeko", 1, null)?.newForm).toBe("morpeko-hangry");
    expect(checkTurnForm("morpeko", 2, "morpeko-hangry")?.newForm).toBeNull();
    expect(checkTurnForm("morpeko", 3, null)?.newForm).toBe("morpeko-hangry");
  });

  it("Castform: weather drives form (sun → sunny, rain → rainy, hail → snowy)", () => {
    expect(checkWeatherForm("castform", "sun", null)?.newForm).toBe("castform-sunny");
    expect(checkWeatherForm("castform", "rain", null)?.newForm).toBe("castform-rainy");
    expect(checkWeatherForm("castform", "hail", null)?.newForm).toBe("castform-snowy");
    // Sandstorm reverts to base; while already in base form, no change.
    expect(checkWeatherForm("castform", "sandstorm", null)).toBeNull();
  });

  it("Darmanitan: HP <= 50% → zen mode, HP > 50% → revert", () => {
    // 50/200 = 25% → zen
    expect(checkHpThresholdForm("darmanitan", 50, 200, 50, null)?.newForm).toBe("darmanitan-zen");
    // 150/200 = 75% while in zen → revert
    expect(checkHpThresholdForm("darmanitan", 150, 200, 50, "darmanitan-zen")?.newForm).toBeNull();
    // 75% in base → no change
    expect(checkHpThresholdForm("darmanitan", 150, 200, 50, null)).toBeNull();
  });

  it("Wishiwashi: HP > 25% & lvl >= 20 → school form", () => {
    expect(checkHpThresholdForm("wishiwashi", 100, 100, 30, null)?.newForm).toBe("wishiwashi-school");
    // Below threshold: revert to solo
    expect(checkHpThresholdForm("wishiwashi", 10, 100, 30, "wishiwashi-school")?.newForm).toBeNull();
  });

  it("Minior: HP <= 50% → core form", () => {
    expect(checkHpThresholdForm("minior", 30, 100, 30, null)?.newForm).toBe("minior-core");
    // Already in core, hp still low → no extra change
    expect(checkHpThresholdForm("minior", 30, 100, 30, "minior-core")).toBeNull();
  });
});
