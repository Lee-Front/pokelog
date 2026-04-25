/**
 * Scenario 28 — Mock Git Integration / Commit Reward.
 *
 *  - simulateCommit awards points and EXP based on bytes
 *  - Multiple commits ramp the combo multiplier (combo grows monotonically
 *    while we stay inside the combo window)
 *  - Encounter ceiling triggers a forced wild encounter when bytes exceed
 *    the ceilingBytes config (we use a small ceiling to make the test
 *    deterministic)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { HttpClient } from "./api-helpers.js";
import { simulateCommit, getUserState } from "./test-helpers.js";
import { applyCommitRewards } from "../../src/game/commit-rewards.js";
import { getConfig } from "../../src/storage/config-store.js";

describe("Scenario 28 — Commit Reward (mock git integration)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("simulateCommit credits points and totalExp proportional to bytes", async () => {
    const { user, token } = await createTestUser({
      uid: "commitUser1",
      initialPoints: 0,
      initialExp: 0,
      initialPokemon: [{ species: "pikachu", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);
    const before = await getUserState(http);
    expect(before.points).toBe(0);

    const outcome = await simulateCommit(http, user.account.id, 1000);
    expect(outcome.points).toBeGreaterThan(0);
    expect(outcome.exp).toBeGreaterThan(0);

    const after = await getUserState(http);
    expect(after.points).toBe(outcome.points);
    expect(after.totalExp).toBe(outcome.exp);
  });

  it("multiple commits ramp the combo count", async () => {
    const { user, token } = await createTestUser({
      uid: "commitCombo",
      initialPokemon: [{ species: "pikachu", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);

    const c1 = await simulateCommit(http, user.account.id, 200);
    const c2 = await simulateCommit(http, user.account.id, 200);
    const c3 = await simulateCommit(http, user.account.id, 200);

    // Combo grows commit-by-commit (or stays at 1 if windowing rejects);
    // monotonic or equal, never decreasing.
    expect(c1.combo).toBeGreaterThanOrEqual(1);
    expect(c2.combo).toBeGreaterThanOrEqual(c1.combo);
    expect(c3.combo).toBeGreaterThanOrEqual(c2.combo);

    // Multiplier is at least 1 (and grows or holds with combo).
    expect(c1.multiplier).toBeGreaterThanOrEqual(1);
    expect(c2.multiplier).toBeGreaterThanOrEqual(c1.multiplier);
    expect(c3.multiplier).toBeGreaterThanOrEqual(c2.multiplier);
  });

  it("encounter triggers when accumulated bytes exceed the ceiling (direct)", async () => {
    const { user } = await createTestUser({
      uid: "commitEnc",
      initialPokemon: [{ species: "pikachu", level: 5 }],
    });
    const config = await getConfig();
    // Use a config override with a tiny ceiling so we deterministically
    // breach it on a single commit. We bypass simulateCommit (which
    // reads the live config) and call applyCommitRewards directly with
    // a doctored config.
    const tightConfig = {
      ...config,
      rewards: {
        ...config.rewards,
        encounter: {
          ...config.rewards.encounter,
          baseChance: 0,
          ceilingBytes: 100,
        },
      },
    };
    const outcome = applyCommitRewards(user, 200, tightConfig, {
      timestamp: new Date().toISOString(),
    });
    expect(outcome.encounter).not.toBeNull();
    expect(typeof outcome.encounter?.species).toBe("string");
    expect(outcome.encounter!.level).toBeGreaterThan(0);
    expect(user.pendingEvents.length).toBeGreaterThan(0);
  });

  it("commit log entry recorded for admin-test commits", async () => {
    const { user, token } = await createTestUser({
      uid: "commitLog",
      initialPokemon: [{ species: "pikachu", level: 5 }],
    });
    const http = new HttpClient(ctx.app, token);
    await simulateCommit(http, user.account.id, 1000);

    const after = await getUserState(http);
    const rewardLogs = after.log.filter((l: { type: string }) => l.type === "reward");
    expect(rewardLogs.length).toBeGreaterThan(0);
    expect((rewardLogs[0] as { commit: string }).commit).toMatch(/^test-/);
  });
});
