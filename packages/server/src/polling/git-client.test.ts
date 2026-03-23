import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  getNewCommits,
  getCommitByteChanges,
  getLatestHash,
} from "./git-client.js";

const exec = promisify(execFile);

describe("git-client", () => {
  let repoDir: string;
  let firstHash: string;
  let secondHash: string;

  beforeAll(async () => {
    // Create a temporary git repo
    repoDir = path.join(os.tmpdir(), `pokelog-git-test-${Date.now()}`);
    await fs.mkdir(repoDir, { recursive: true });

    // Init repo
    await exec("git", ["init", "--initial-branch=main"], { cwd: repoDir });
    await exec("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await exec("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });

    // First commit: create a file with known content
    const file1 = path.join(repoDir, "hello.txt");
    await fs.writeFile(file1, "hello world\n"); // 12 bytes
    await exec("git", ["add", "hello.txt"], { cwd: repoDir });
    await exec("git", ["commit", "-m", "first commit"], { cwd: repoDir });

    const { stdout: hash1 } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
    });
    firstHash = hash1.trim();

    // Second commit: modify the file
    await fs.writeFile(file1, "hello world updated content\n"); // 28 bytes
    await exec("git", ["add", "hello.txt"], { cwd: repoDir });
    await exec("git", ["commit", "-m", "second commit"], { cwd: repoDir });

    const { stdout: hash2 } = await exec("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
    });
    secondHash = hash2.trim();

    // Set up fake origin refs so origin/main resolves
    // In a non-bare repo, we simulate "origin/main" by creating the ref directly
    await exec(
      "git",
      ["update-ref", "refs/remotes/origin/main", secondHash],
      { cwd: repoDir },
    );
  });

  afterAll(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("getNewCommits returns commits in oldest-first order", async () => {
    const commits = await getNewCommits(repoDir, "main", null);
    expect(commits.length).toBe(2);
    expect(commits[0].hash).toBe(firstHash);
    expect(commits[1].hash).toBe(secondHash);
    expect(commits[0].authorEmail).toBe("test@example.com");
    expect(commits[0].message).toBe("first commit");
    expect(commits[1].message).toBe("second commit");
  });

  it("getNewCommits with lastHash returns only newer commits", async () => {
    const commits = await getNewCommits(repoDir, "main", firstHash);
    expect(commits.length).toBe(1);
    expect(commits[0].hash).toBe(secondHash);
  });

  it("getCommitByteChanges returns correct bytes for new file", async () => {
    const bytes = await getCommitByteChanges(repoDir, firstHash);
    // "hello world\n" = 12 bytes
    expect(bytes).toBe(12);
  });

  it("getCommitByteChanges returns correct bytes for modified file", async () => {
    const bytes = await getCommitByteChanges(repoDir, secondHash);
    // max(old=12, new=28) = 28
    expect(bytes).toBe(28);
  });

  it("getLatestHash returns the latest commit hash", async () => {
    const hash = await getLatestHash(repoDir, "main");
    expect(hash).toBe(secondHash);
  });

  it("getLatestHash returns null for nonexistent branch", async () => {
    const hash = await getLatestHash(repoDir, "nonexistent-branch");
    expect(hash).toBeNull();
  });
});
