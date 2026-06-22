import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);

/**
 * Regression for the multi-branch double-counting bug: a commit reachable from
 * several branches (shared base history) must be rewarded exactly once, not
 * once per branch. Exercises the real pollAllRepos path against a local repo.
 */
describe("multi-branch commit dedup (pollAllRepos)", () => {
  let dataDir: string;
  let sourceRepo: string;

  async function git(args: string[], cwd: string) {
    await exec("git", args, { cwd });
  }

  beforeEach(async () => {
    dataDir = path.join(os.tmpdir(), `pokelog-mbdedup-data-${randomUUID()}`);
    await fs.mkdir(path.join(dataDir, "users"), { recursive: true });
    process.env.POKELOG_DATA_DIR = dataDir;

    // Config: 1 admin repo, encounters off, combo flat (multiplier 1) for a
    // clean byte->point accounting.
    sourceRepo = path.join(os.tmpdir(), `pokelog-mbdedup-src-${randomUUID()}`);
    await fs.mkdir(sourceRepo, { recursive: true });
    await git(["init", "--initial-branch=main"], sourceRepo);
    await git(["config", "user.email", "dev@corp.example"], sourceRepo);
    await git(["config", "user.name", "Dev"], sourceRepo);

    // Shared base commit on main (reachable from both branches).
    await fs.writeFile(path.join(sourceRepo, "base.txt"), "base content\n");
    await git(["add", "-A"], sourceRepo);
    await git(["commit", "-m", "base"], sourceRepo);

    // Feature branch with its own commit; main with its own commit.
    await git(["checkout", "-b", "feature"], sourceRepo);
    await fs.writeFile(path.join(sourceRepo, "feature.txt"), "feature content\n");
    await git(["add", "-A"], sourceRepo);
    await git(["commit", "-m", "feature work"], sourceRepo);
    await git(["checkout", "main"], sourceRepo);
    await fs.writeFile(path.join(sourceRepo, "main.txt"), "main content\n");
    await git(["add", "-A"], sourceRepo);
    await git(["commit", "-m", "main work"], sourceRepo);

    const repoUrl = pathToFileURL(sourceRepo).toString();
    await fs.writeFile(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        polling: { intervalMinutes: 5, repos: [{ url: repoUrl, branches: ["main", "feature"] }] },
        rewards: {
          expPerByte: 1,
          pointsPerByte: 1,
          combo: { bytesPerMinute: 1e12, multipliers: [1], maxMultiplier: 1 },
          encounter: { baseChance: 0, ceilingBytes: 1e12, timeLimitHours: 24 },
        },
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(sourceRepo, { recursive: true, force: true });
    delete process.env.POKELOG_DATA_DIR;
  });

  it("rewards the shared base commit exactly once across two branches", async () => {
    vi.resetModules();
    const { saveUser, getUser } = await import("../../src/storage/user-store.js");
    const { pollAllRepos } = await import("../../src/polling/polling-worker.js");

    await saveUser({
      account: {
        id: "ash", password: "x", nickname: "Ash",
        createdAt: new Date().toISOString(),
        matchings: { git: { emails: ["dev@corp.example"] } },
      },
      points: 0, gameMoney: 0, totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
      encounterCeiling: { accumulatedBytes: 0 },
      party: [], pokemon: [], eggs: [], pokedex: [], inventory: {},
      pendingEvents: [], pendingEvolutions: [], currentRegion: "default",
      battleState: null, storage: [], log: [], integrations: [],
    } as any);

    await pollAllRepos();

    const user = await getUser("ash");
    const rewardLog = user!.log.filter((e) => e.type === "reward");
    const hashes = rewardLog.map((e) => e.commit);
    const uniqueHashes = new Set(hashes);

    // 3 unique commits (base, feature work, main work) — each rewarded once.
    // Before the fix, the shared base commit was rewarded twice (once per
    // branch), giving 4 reward entries with a duplicated hash.
    expect(rewardLog.length).toBe(3);
    expect(uniqueHashes.size).toBe(3);
    // No commit hash appears more than once in the reward log.
    expect(hashes.length).toBe(uniqueHashes.size);

    // points == total bytes (pointsPerByte=1, combo=1), summed once per commit.
    const totalBytes = rewardLog.reduce((s, e) => s + (e.bytes || 0), 0);
    expect(user!.points).toBe(totalBytes);
  });

  it("does not re-reward on a second poll with no new commits", async () => {
    vi.resetModules();
    const { saveUser, getUser } = await import("../../src/storage/user-store.js");
    const { pollAllRepos } = await import("../../src/polling/polling-worker.js");

    await saveUser({
      account: {
        id: "misty", password: "x", nickname: "Misty",
        createdAt: new Date().toISOString(),
        matchings: { git: { emails: ["dev@corp.example"] } },
      },
      points: 0, gameMoney: 0, totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
      encounterCeiling: { accumulatedBytes: 0 },
      party: [], pokemon: [], eggs: [], pokedex: [], inventory: {},
      pendingEvents: [], pendingEvolutions: [], currentRegion: "default",
      battleState: null, storage: [], log: [], integrations: [],
    } as any);

    await pollAllRepos();
    const afterFirst = (await getUser("misty"))!.points;
    expect(afterFirst).toBeGreaterThan(0);

    await pollAllRepos();
    const afterSecond = (await getUser("misty"))!.points;
    expect(afterSecond).toBe(afterFirst); // no new commits → no extra reward
  });

  it("does not re-reward a feature commit after it is merged into main (cross-poll)", async () => {
    vi.resetModules();
    const { saveUser, getUser } = await import("../../src/storage/user-store.js");
    const { pollAllRepos } = await import("../../src/polling/polling-worker.js");

    await saveUser({
      account: {
        id: "brock", password: "x", nickname: "Brock",
        createdAt: new Date().toISOString(),
        matchings: { git: { emails: ["dev@corp.example"] } },
      },
      points: 0, gameMoney: 0, totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
      encounterCeiling: { accumulatedBytes: 0 },
      party: [], pokemon: [], eggs: [], pokedex: [], inventory: {},
      pendingEvents: [], pendingEvolutions: [], currentRegion: "default",
      battleState: null, storage: [], log: [], integrations: [],
    } as any);

    // First poll processes the existing base/feature/main commits.
    await pollAllRepos();
    const afterFirst = await getUser("brock");
    const firstHashes = new Set(
      afterFirst!.log.filter((e) => e.type === "reward").map((e) => e.commit),
    );
    expect(firstHashes.size).toBe(3);

    // The feature branch (already polled) is merged into main with --no-ff.
    // The merge brings the feature commit's history onto main; the merge commit
    // itself has 2 parents and is skipped, and the feature commit must NOT be
    // rewarded a second time because it was already processed on poll 1.
    await git(["merge", "--no-ff", "feature", "-m", "merge feature into main"], sourceRepo);

    await pollAllRepos();
    const afterSecond = await getUser("brock");
    const secondReward = afterSecond!.log.filter((e) => e.type === "reward");
    const secondHashes = secondReward.map((e) => e.commit);

    // No reward hash repeats across the whole history, and every previously
    // rewarded feature/base commit stays counted exactly once.
    expect(secondHashes.length).toBe(new Set(secondHashes).size);
    for (const h of firstHashes) {
      expect(secondHashes.filter((x) => x === h).length).toBe(1);
    }
    // The merge commit (2 parents) is not rewarded.
    expect(secondReward.length).toBe(firstHashes.size);
  });
});
