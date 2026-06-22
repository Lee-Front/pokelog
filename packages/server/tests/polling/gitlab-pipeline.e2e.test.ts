import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { UserData } from "../../../../shared/types.js";

const exec = promisify(execFile);

/**
 * End-to-end exercise of the commit-reward polling pipeline against a real git
 * repository: cloneBareRepo -> fetchRepo -> getNewCommits -> processCommit ->
 * user matching + reward application.
 *
 * git-client is pure git CLI, so this local-repo run is representative of an
 * on-prem GitLab HTTPS remote (the only difference is the transport URL and
 * oauth2 token injection, which are covered by git-client-security.test.ts).
 */

let tmpDataDir: string;
let sourceRepo: string;
let store: typeof import("../../src/storage/user-store.js");
let gitClient: typeof import("../../src/polling/git-client.js");
let processor: typeof import("../../src/polling/commit-processor.js");

async function gitInit(repoDir: string, authorEmail: string): Promise<void> {
  await fsp.mkdir(repoDir, { recursive: true });
  await exec("git", ["init", "--initial-branch=main"], { cwd: repoDir });
  await exec("git", ["config", "user.email", authorEmail], { cwd: repoDir });
  await exec("git", ["config", "user.name", "Dev User"], { cwd: repoDir });
}

async function commitFile(
  repoDir: string,
  file: string,
  content: string,
  message: string,
): Promise<string> {
  await fsp.writeFile(path.join(repoDir, file), content);
  await exec("git", ["add", file], { cwd: repoDir });
  await exec("git", ["commit", "-m", message], { cwd: repoDir });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: repoDir });
  return stdout.trim();
}

function makeUser(id: string, email: string): UserData {
  return {
    account: {
      id,
      password: "pw",
      nickname: id,
      createdAt: "2026-06-01T00:00:00.000Z",
      matchings: { git: { emails: [email] } },
    },
    currentRegion: "default",
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
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

beforeEach(async () => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-gitlab-e2e-"));
  sourceRepo = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-gitlab-src-"));
  process.env.POKELOG_DATA_DIR = tmpDataDir;
  // Pin reward coefficients so the assertions are independent of the (now
  // conservative) production default rates, which would floor small test
  // commits to 0 points.
  fs.writeFileSync(
    path.join(tmpDataDir, "config.json"),
    JSON.stringify({
      rewards: {
        expPerByte: 1,
        pointsPerByte: 1,
        combo: { bytesPerMinute: 1e12, multipliers: [1], maxMultiplier: 1 },
        encounter: { baseChance: 0, ceilingBytes: 1e12, timeLimitHours: 24 },
      },
    }),
  );
  vi.resetModules();
  store = await import("../../src/storage/user-store.js");
  gitClient = await import("../../src/polling/git-client.js");
  processor = await import("../../src/polling/commit-processor.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  fs.rmSync(sourceRepo, { recursive: true, force: true });
});

describe("GitLab-style polling pipeline (E2E)", () => {
  it("clones, fetches, reads new commits, and rewards the matching user", async () => {
    const authorEmail = "dev@corp.example.com";
    const repoUrl = `file://${sourceRepo.replace(/\\/g, "/")}`;

    await gitInit(sourceRepo, authorEmail);
    await commitFile(sourceRepo, "a.txt", "first commit content\n", "feat: first");

    // Register a user whose git matching email equals the commit author.
    await store.saveUser(makeUser("ash", authorEmail));

    // Bare-clone via the production code path (public auth, local transport),
    // then fetch — the production poller always clones then fetches before
    // reading, which is also what populates refs/remotes/origin/* on a bare clone.
    const bareDir = path.join(tmpDataDir, "repos", "source.git");
    await gitClient.cloneBareRepo(repoUrl, bareDir, "public");
    await gitClient.fetchRepo(bareDir);

    // First poll: no prior hash, so all commits are new.
    const firstHashes = await gitClient.getNewCommits(bareDir, "main", null);
    expect(firstHashes.length).toBe(1);
    expect(firstHashes[0].authorEmail).toBe(authorEmail);

    for (const commit of firstHashes) {
      await processor.processCommit(commit, bareDir, repoUrl);
    }

    const afterFirst = await store.getUser("ash");
    expect(afterFirst).not.toBeNull();
    expect(afterFirst!.totalExp).toBeGreaterThan(0);
    expect(afterFirst!.points).toBeGreaterThan(0);
    expect(afterFirst!.log.some((entry) => entry.type === "reward")).toBe(true);

    const lastHash = await gitClient.getLatestHash(bareDir, "main");
    expect(lastHash).toBe(firstHashes[0].hash);

    // A second commit lands upstream; fetch + incremental read picks up only it.
    await commitFile(sourceRepo, "b.txt", "second commit body here\n", "feat: second");
    await gitClient.fetchRepo(bareDir);

    const newHashes = await gitClient.getNewCommits(bareDir, "main", lastHash);
    expect(newHashes.length).toBe(1);

    const expBefore = afterFirst!.totalExp;
    for (const commit of newHashes) {
      await processor.processCommit(commit, bareDir, repoUrl);
    }

    const afterSecond = await store.getUser("ash");
    expect(afterSecond!.totalExp).toBeGreaterThan(expBefore);
  }, 60000);

  it("does not reward a user whose email does not match the commit author", async () => {
    const repoUrl = `file://${sourceRepo.replace(/\\/g, "/")}`;
    await gitInit(sourceRepo, "someone-else@corp.example.com");
    await commitFile(sourceRepo, "a.txt", "content\n", "feat: x");

    await store.saveUser(makeUser("misty", "misty@corp.example.com"));

    const bareDir = path.join(tmpDataDir, "repos", "source.git");
    await gitClient.cloneBareRepo(repoUrl, bareDir, "public");
    await gitClient.fetchRepo(bareDir);
    const commits = await gitClient.getNewCommits(bareDir, "main", null);
    for (const commit of commits) {
      await processor.processCommit(commit, bareDir, repoUrl);
    }

    const misty = await store.getUser("misty");
    expect(misty!.totalExp).toBe(0);
    expect(misty!.points).toBe(0);
  }, 60000);

  it("skips merge commits (parentCount >= 2)", async () => {
    const authorEmail = "dev@corp.example.com";
    const repoUrl = `file://${sourceRepo.replace(/\\/g, "/")}`;
    await gitInit(sourceRepo, authorEmail);
    await commitFile(sourceRepo, "base.txt", "base\n", "base");

    // Create a branch, commit, then merge with --no-ff to force a merge commit.
    await exec("git", ["checkout", "-b", "feature"], { cwd: sourceRepo });
    await commitFile(sourceRepo, "feature.txt", "feature\n", "feature work");
    await exec("git", ["checkout", "main"], { cwd: sourceRepo });
    await commitFile(sourceRepo, "main.txt", "main\n", "main work");
    await exec("git", ["merge", "--no-ff", "feature", "-m", "merge feature"], {
      cwd: sourceRepo,
    });

    await store.saveUser(makeUser("ash", authorEmail));

    const bareDir = path.join(tmpDataDir, "repos", "source.git");
    await gitClient.cloneBareRepo(repoUrl, bareDir, "public");
    await gitClient.fetchRepo(bareDir);
    const commits = await gitClient.getNewCommits(bareDir, "main", null);

    const mergeCommits = commits.filter((c) => c.parentCount >= 2);
    expect(mergeCommits.length).toBe(1);

    const ashBefore = await store.getUser("ash");
    const logCountBefore = ashBefore!.log.length;

    // Processing the merge commit alone must be a no-op (no reward log added).
    for (const merge of mergeCommits) {
      await processor.processCommit(merge, bareDir, repoUrl);
    }
    const ashAfter = await store.getUser("ash");
    expect(ashAfter!.log.length).toBe(logCountBefore);
  }, 60000);
});
