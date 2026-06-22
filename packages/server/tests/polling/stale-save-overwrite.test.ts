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
 * Regression for #19: the stale-save overwrite that zeroed points/exp right
 * after an integration sync.
 *
 * The shape of the bug: git rewards are applied by processCommit, which loads
 * the user fresh, accrues, and saves atomically. The surrounding poll function
 * held an *older* in-memory user object (loaded before git polling, or a
 * getAllUsers snapshot) and saved it at the end — overwriting the git accrual
 * with the pre-commit balance (often 0 on the very first poll).
 *
 * We simulate a non-git integration that legitimately rewards the user (notion)
 * via a mock that mutates AND saves its passed-in `user`, then run a real git
 * poll over a local repo in the same cycle. The git accrual must survive.
 */

// Notion poll stub: behaves like the real one — mutates the passed user and
// persists it when "changed". This is the object that, pre-fix, clobbered the
// git accrual when the poll function re-saved it after git polling.
vi.mock("../../src/integrations/notion-polling.js", () => ({
  pollNotionIntegration: vi.fn(async (user: any) => {
    const { saveUser } = await import("../../src/storage/user-store.js");
    user.points += 5; // a small notion reward
    await saveUser(user);
    return { snapshotCount: 0, firstSync: false, detectedEvents: 1, appliedEvents: 1 };
  }),
}));

async function git(args: string[], cwd: string) {
  await exec("git", args, { cwd });
}

describe("stale-save overwrite of git accrual (#19)", () => {
  let dataDir: string;
  let sourceRepo: string;
  let repoUrl: string;

  beforeEach(async () => {
    // Keep paths short: the repo's local clone dir is derived from the full
    // source URL, and a long temp path overflows Windows' path limit on the
    // pack .keep file during clone.
    const tag = randomUUID().slice(0, 8);
    dataDir = path.join(os.tmpdir(), `pl-ss-d-${tag}`);
    await fs.mkdir(path.join(dataDir, "users"), { recursive: true });
    process.env.POKELOG_DATA_DIR = dataDir;

    sourceRepo = path.join(os.tmpdir(), `pl-ss-s-${tag}`);
    await fs.mkdir(sourceRepo, { recursive: true });
    await git(["init", "--initial-branch=main"], sourceRepo);
    await git(["config", "user.email", "dev@corp.example"], sourceRepo);
    await git(["config", "user.name", "Dev"], sourceRepo);
    // One non-trivial commit so getCommitByteChanges > 0 and a reward applies.
    await fs.writeFile(path.join(sourceRepo, "main.txt"), "a".repeat(500) + "\n");
    await git(["add", "-A"], sourceRepo);
    await git(["commit", "-m", "main work"], sourceRepo);

    repoUrl = pathToFileURL(sourceRepo).toString();

    // Combo flat (multiplier 1), encounters off → points == bytes per commit.
    await fs.writeFile(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        polling: { intervalMinutes: 5, repos: [] },
        rewards: {
          expPerByte: 1,
          pointsPerByte: 1,
          combo: { bytesPerMinute: 1e12, multipliers: [1], maxMultiplier: 1 },
          encounter: { baseChance: 0, ceilingBytes: 1e12, timeLimitHours: 24 },
          integrations: {},
        },
      }),
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(sourceRepo, { recursive: true, force: true });
    delete process.env.POKELOG_DATA_DIR;
  });

  function makeUser(id: string) {
    return {
      account: {
        id,
        password: "x",
        nickname: id,
        createdAt: new Date().toISOString(),
        matchings: { git: { emails: ["dev@corp.example"] } },
      },
      points: 0,
      gameMoney: 0,
      totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
      encounterCeiling: { accumulatedBytes: 0 },
      party: [],
      pokemon: [],
      eggs: [],
      pokedex: [],
      inventory: {},
      pendingEvents: [],
      pendingEvolutions: [],
      currentRegion: "default",
      battleState: null,
      storage: [],
      log: [],
      integrations: [
        {
          id: "git-1",
          provider: "git",
          label: "repo",
          failCount: 0,
          status: "ok",
          emails: ["dev@corp.example"],
          config: { repoUrl },
        },
        {
          id: "notion-1",
          provider: "notion",
          label: "notion",
          failCount: 0,
          status: "ok",
          config: { token: "t", targets: [] },
        },
      ],
    } as any;
  }

  it("pollUserIntegrations: git accrual survives the notion integration save", async () => {
    vi.resetModules();
    const { saveUser, getUser } = await import("../../src/storage/user-store.js");
    const { pollUserIntegrations } = await import("../../src/polling/polling-worker.js");

    await saveUser(makeUser("ash"));
    await pollUserIntegrations("ash");

    const user = await getUser("ash");
    const rewardLog = user!.log.filter((e) => e.type === "reward");
    const gitBytes = rewardLog.reduce((s, e) => s + (e.bytes || 0), 0);

    // Git reward must be present and persisted (not overwritten by the stale
    // notion save). Pre-fix this was 0 because the post-git saveUser clobbered it.
    expect(gitBytes).toBeGreaterThan(0);
    expect(rewardLog.length).toBe(1);
    // points = git bytes + notion reward (5); both survive.
    expect(user!.points).toBe(gitBytes + 5);
  });

  it("pollAllRepos: git accrual survives the notion integration save", async () => {
    vi.resetModules();
    const { saveUser, getUser } = await import("../../src/storage/user-store.js");
    const { pollAllRepos } = await import("../../src/polling/polling-worker.js");

    await saveUser(makeUser("misty"));
    await pollAllRepos();

    const user = await getUser("misty");
    const rewardLog = user!.log.filter((e) => e.type === "reward");
    const gitBytes = rewardLog.reduce((s, e) => s + (e.bytes || 0), 0);

    expect(gitBytes).toBeGreaterThan(0);
    expect(rewardLog.length).toBe(1);
    expect(user!.points).toBe(gitBytes + 5);
  });

  it("appends a point_gain event to event-log.jsonl when a commit is rewarded (#7)", async () => {
    vi.resetModules();
    const { saveUser } = await import("../../src/storage/user-store.js");
    const { pollAllRepos } = await import("../../src/polling/polling-worker.js");

    await saveUser(makeUser("brock"));
    await pollAllRepos();

    const logPath = path.join(dataDir, "event-log.jsonl");
    const content = await fs.readFile(logPath, "utf-8");
    const events = content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const pointGains = events.filter((e) => e.type === "point_gain" && e.userId === "brock");
    expect(pointGains.length).toBe(1);
    expect(pointGains[0].detail.points).toBeGreaterThan(0);
  });
});
