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
 * Admin recompute tool: rebuild ONE user's commit-derived balance from git
 * history without touching the shared per-repo syncState — so other users on the
 * same repo are not double-rewarded on their next poll (the #19-adjacent risk).
 */
describe("recomputeUser (admin recompute tool)", () => {
  let dataDir: string;
  let sourceRepo: string;
  let repoUrl: string;

  async function git(args: string[], cwd: string, env?: Record<string, string>) {
    await exec("git", args, { cwd, env: { ...process.env, ...env } });
  }

  async function commitAs(email: string, file: string, content: string) {
    await fs.writeFile(path.join(sourceRepo, file), content);
    await git(["add", "-A"], sourceRepo);
    await git(
      ["commit", "-m", `${file} by ${email}`],
      sourceRepo,
      {
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_NAME: "Dev",
        GIT_COMMITTER_EMAIL: email,
        GIT_COMMITTER_NAME: "Dev",
      },
    );
  }

  function makeUser(id: string, integrationEmail: string) {
    return {
      account: {
        id,
        password: "x",
        nickname: id,
        createdAt: new Date().toISOString(),
        matchings: {},
      },
      points: 0,
      gameMoney: 0,
      totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
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
          id: `git-${id}`,
          provider: "git" as const,
          label: "repo",
          status: "ok" as const,
          failCount: 0,
          addedAt: new Date().toISOString(),
          config: { repoUrl, authMode: "public" as const },
          emails: [integrationEmail],
        },
      ],
    };
  }

  beforeEach(async () => {
    // Short prefixes: the bare-clone target nests the sanitized repo URL under
    // dataDir/repos, so a long dataDir path would blow past Windows' MAX_PATH.
    dataDir = path.join(os.tmpdir(), `pl-rc-d-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(path.join(dataDir, "users"), { recursive: true });
    process.env.POKELOG_DATA_DIR = dataDir;

    sourceRepo = path.join(os.tmpdir(), `pl-rc-s-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(sourceRepo, { recursive: true });
    await git(["init", "--initial-branch=main"], sourceRepo);

    // Two authors interleaved on main. Encounters off, combo flat (mult 1),
    // 1 byte -> 1 point/exp for clean accounting.
    await commitAs("alice@corp.example", "a1.txt", "alice one\n");
    await commitAs("bob@corp.example", "b1.txt", "bob one\n");
    await commitAs("alice@corp.example", "a2.txt", "alice two\n");

    repoUrl = pathToFileURL(sourceRepo).toString();
    await fs.writeFile(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        polling: { intervalMinutes: 5, repos: [] },
        rewards: {
          expPerByte: 1,
          pointsPerByte: 1,
          combo: { bytesPerMinute: 1e12, multipliers: [1], maxMultiplier: 1 },
          encounter: { rollCount: 12 },
        },
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(sourceRepo, { recursive: true, force: true });
    delete process.env.POKELOG_DATA_DIR;
  });

  it("recomputes one user's balance from commits and leaves others + syncState untouched", async () => {
    vi.resetModules();
    const { saveUser, getUser } = await import("../../src/storage/user-store.js");
    const { pollUserIntegrations, recomputeUserSerialized } = await import(
      "../../src/polling/polling-worker.js"
    );
    const { getSyncState } = await import("../../src/storage/sync-state-store.js");

    await saveUser(makeUser("alice", "alice@corp.example") as any);
    await saveUser(makeUser("bob", "bob@corp.example") as any);

    // Normal forward poll for both: this advances syncState tips.
    await pollUserIntegrations("alice");
    await pollUserIntegrations("bob");

    const aliceAfterPoll = (await getUser("alice"))!.points;
    const bobAfterPoll = (await getUser("bob"))!.points;
    expect(aliceAfterPoll).toBeGreaterThan(0); // alice authored 2 commits
    expect(bobAfterPoll).toBeGreaterThan(0); // bob authored 1 commit

    const syncBefore = JSON.stringify((await getSyncState()).repos);

    // Simulate the #19 reset: alice's balance is wiped to 0.
    const broken = (await getUser("alice"))!;
    broken.points = 0;
    broken.totalExp = 0;
    broken.combo = { count: 0, lastCommitAt: null };
    await saveUser(broken, "admin-adjust");
    expect((await getUser("alice"))!.points).toBe(0);

    // Recompute alice only.
    const result = await recomputeUserSerialized("alice");

    // alice's commit-derived balance is rebuilt to exactly the poll value.
    expect(result.before.points).toBe(0);
    expect(result.after.points).toBe(aliceAfterPoll);
    expect((await getUser("alice"))!.points).toBe(aliceAfterPoll);
    expect((await getUser("alice"))!.totalExp).toBe(aliceAfterPoll); // expPerByte == pointsPerByte
    expect(result.commitsApplied).toBe(2); // only alice's two commits

    // bob is entirely unaffected.
    expect((await getUser("bob"))!.points).toBe(bobAfterPoll);

    // syncState (per-repo tips) is unchanged — bob will not be re-rewarded next poll.
    const syncAfter = JSON.stringify((await getSyncState()).repos);
    expect(syncAfter).toBe(syncBefore);

    // A subsequent normal poll of bob does NOT double-reward him (tips intact).
    await pollUserIntegrations("bob");
    expect((await getUser("bob"))!.points).toBe(bobAfterPoll);
  });

  it("only counts commits matching the user's integration emails", async () => {
    vi.resetModules();
    const { saveUser, getUser } = await import("../../src/storage/user-store.js");
    const { recomputeUserSerialized } = await import("../../src/polling/polling-worker.js");

    await saveUser(makeUser("alice", "alice@corp.example") as any);

    const result = await recomputeUserSerialized("alice");
    // Repo has 3 commits (2 alice, 1 bob); only alice's 2 are applied.
    expect(result.commitsApplied).toBe(2);
    const alice = (await getUser("alice"))!;
    const rewardLog = alice.log.filter((e) => e.type === "reward");
    expect(rewardLog.length).toBe(2);
    expect(alice.points).toBeGreaterThan(0);
  });
});
