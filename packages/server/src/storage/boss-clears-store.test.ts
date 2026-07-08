import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getClears, PARTICIPATION_POINTS, pointsForRank, RANK_POINTS, registerBossClear } from "./boss-clears-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = path.join(os.tmpdir(), `pokelog-bossclears-${randomUUID()}`);
  await fs.mkdir(dataDir, { recursive: true });
  process.env.POKELOG_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.POKELOG_DATA_DIR;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("pointsForRank", () => {
  it("returns the ranked prize for 1st-3rd and a flat participation prize after", () => {
    expect(pointsForRank(1)).toBe(RANK_POINTS[0]);
    expect(pointsForRank(2)).toBe(RANK_POINTS[1]);
    expect(pointsForRank(3)).toBe(RANK_POINTS[2]);
    expect(pointsForRank(4)).toBe(PARTICIPATION_POINTS);
    expect(pointsForRank(50)).toBe(PARTICIPATION_POINTS);
  });
});

describe("registerBossClear / getClears", () => {
  it("assigns ranks 1..3 the unified point tiers in defeat order", async () => {
    const first = await registerBossClear(3000, "steel-wall", "u1", "Alice");
    const second = await registerBossClear(3000, "steel-wall", "u2", "Bob");
    const third = await registerBossClear(3000, "steel-wall", "u3", "Carol");

    expect(first).toEqual({ userId: "u1", nickname: "Alice", rank: 1, points: 3000, at: first.at });
    expect(second.rank).toBe(2);
    expect(second.points).toBe(2000);
    expect(third.rank).toBe(3);
    expect(third.points).toBe(1000);
  });

  it("gives a flat participation prize to the 4th+ clearer", async () => {
    await registerBossClear(3000, "steel-wall", "u1", "Alice");
    await registerBossClear(3000, "steel-wall", "u2", "Bob");
    await registerBossClear(3000, "steel-wall", "u3", "Carol");
    const fourth = await registerBossClear(3000, "steel-wall", "u4", "Dave");

    expect(fourth.rank).toBe(4);
    expect(fourth.points).toBe(PARTICIPATION_POINTS);
  });

  it("is idempotent per user — re-registering returns the original rank, not a new one", async () => {
    const first = await registerBossClear(3000, "steel-wall", "u1", "Alice");
    await registerBossClear(3000, "steel-wall", "u2", "Bob");
    const again = await registerBossClear(3000, "steel-wall", "u1", "Alice");

    expect(again).toEqual(first);
    const clears = await getClears(3000, "steel-wall");
    expect(clears).toHaveLength(2);
  });

  it("keeps separate rankings per week and per boss", async () => {
    await registerBossClear(3000, "steel-wall", "u1", "Alice");
    const otherBoss = await registerBossClear(3000, "rain-tyrant", "u1", "Alice");
    const otherWeek = await registerBossClear(3001, "steel-wall", "u1", "Alice");

    expect(otherBoss.rank).toBe(1);
    expect(otherWeek.rank).toBe(1);
  });

  it("getClears returns an empty list when nobody has cleared yet", async () => {
    expect(await getClears(3000, "steel-wall")).toEqual([]);
  });
});
