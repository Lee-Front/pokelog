/**
 * Scenario 36 — Tower Boss Stages.
 *
 *  - Stage 5 reward → rare-egg
 *  - Stage 10 reward → epic-egg
 *  - Stage 50 reward → master-ball; AI party may include legendaries
 *  - Stage 100 reward → ultra-necrozium-z; AI party uses level 60 mons
 *
 * We don't actually battle through 100 stages — we drive
 * generateTowerParty / getStageReward / getStageConfig directly to
 * pin the per-stage scaling.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { generateTowerParty, getStageConfig } from "../../src/game/tower-ai.js";
import { getStageReward } from "../../src/game/tower.js";

describe("Scenario 36 — Tower Boss Stages", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("stage 1 reward: 100 points, no items", () => {
    const reward = getStageReward(1);
    expect(reward.points).toBe(100);
    expect(reward.items).toEqual([]);
  });

  it("stage 5 reward: rare-egg", () => {
    const reward = getStageReward(5);
    expect(reward.points).toBe(500);
    expect(reward.items).toContainEqual({ id: "rare-egg", amount: 1 });
  });

  it("stage 10 reward: epic-egg", () => {
    const reward = getStageReward(10);
    expect(reward.points).toBe(2000);
    expect(reward.items).toContainEqual({ id: "epic-egg", amount: 1 });
  });

  it("stage 50 reward: master-ball + scaled points", () => {
    const reward = getStageReward(50);
    expect(reward.points).toBe(20000);
    expect(reward.items).toContainEqual({ id: "master-ball", amount: 1 });
  });

  it("stage 100 reward: ultra-necrozium-z + 100k points", () => {
    const reward = getStageReward(100);
    expect(reward.points).toBe(100000);
    expect(reward.items).toContainEqual({ id: "ultra-necrozium-z", amount: 1 });
  });

  it("stage scaling: legendaries appear from stage 50", () => {
    const cfg5 = getStageConfig(5);
    const cfg50 = getStageConfig(50);
    const cfg100 = getStageConfig(100);
    expect(cfg5.useLegendary).toBe(false);
    expect(cfg50.useLegendary).toBe(true);
    expect(cfg100.useLegendary).toBe(true);
    // Level scaling: stage 5 → 45, stage 50 → 55, stage 100 → 60
    expect(cfg5.level).toBe(45);
    expect(cfg50.level).toBe(55);
    expect(cfg100.level).toBe(60);
  });

  it("generateTowerParty(stage) produces a 1-3 mon party respecting Species Clause", () => {
    for (const stage of [1, 5, 10, 50, 100]) {
      const party = generateTowerParty(stage);
      expect(party.length).toBeGreaterThanOrEqual(1);
      expect(party.length).toBeLessThanOrEqual(3);
      const speciesSet = new Set(party.map((p) => p.species));
      expect(speciesSet.size).toBe(party.length);
      // Every pokemon has at least one move and a stat block.
      for (const p of party) {
        expect(p.moves.length).toBeGreaterThan(0);
        expect(p.maxHp).toBeGreaterThan(0);
      }
    }
  });

  it("stage 100 AI party is level 60", () => {
    const party = generateTowerParty(100);
    for (const p of party) {
      expect(p.level).toBe(60);
    }
  });

  it("intermediate stages (e.g. stage 7) fall through to linear point scaling", () => {
    const reward7 = getStageReward(7);
    // No explicit entry → 50 * stage = 350
    expect(reward7.points).toBe(350);
    expect(reward7.items).toEqual([]);
  });
});
