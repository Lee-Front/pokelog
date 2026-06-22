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
  listAuthorEmails,
  resolveRepoUrl,
  testRepoAccess,
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

  it("getCommitByteChanges counts added text (diff) for new file", async () => {
    const bytes = await getCommitByteChanges(repoDir, firstHash);
    // 추가된 줄 "+hello world" → 내용 "hello world" = 11 bytes (전체 파일 크기가 아님)
    expect(bytes).toBe(11);
  });

  it("getCommitByteChanges counts added+deleted text for modified file", async () => {
    const bytes = await getCommitByteChanges(repoDir, secondHash);
    // 삭제 "hello world"(11) + 추가 "hello world updated content"(27) = 38
    expect(bytes).toBe(38);
  });

  it("getLatestHash returns the latest commit hash", async () => {
    const hash = await getLatestHash(repoDir, "main");
    expect(hash).toBe(secondHash);
  });

  it("getLatestHash returns null for nonexistent branch", async () => {
    const hash = await getLatestHash(repoDir, "nonexistent-branch");
    expect(hash).toBeNull();
  });

  it("listAuthorEmails aggregates counts and sorts descending", async () => {
    // Two commits authored by test@example.com already exist; add one from a
    // second author so we can assert ordering by count.
    await exec("git", ["config", "user.email", "other@example.com"], { cwd: repoDir });
    await exec("git", ["config", "user.name", "Other User"], { cwd: repoDir });
    const file2 = path.join(repoDir, "second.txt");
    await fs.writeFile(file2, "from other\n");
    await exec("git", ["add", "second.txt"], { cwd: repoDir });
    await exec("git", ["commit", "-m", "other author commit"], { cwd: repoDir });

    const emails = await listAuthorEmails(repoDir);
    expect(emails[0]).toEqual({ email: "test@example.com", count: 2 });
    expect(emails).toContainEqual({ email: "other@example.com", count: 1 });
    // restore the original author for any later-added tests sharing this repo
    await exec("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  });
});

describe("resolveRepoUrl — port preservation (complements git-client-security.test)", () => {
  it("preserves a non-default port and path when injecting credentials", () => {
    // On-prem GitLab often runs on a custom HTTPS port; the injected userinfo
    // must not disturb host:port/path.
    const url = resolveRepoUrl(
      "https://gitlab.internal.corp:8443/team/repo.git",
      "token",
      "secret-token",
    );
    expect(url).toBe(
      "https://oauth2:secret-token@gitlab.internal.corp:8443/team/repo.git",
    );
  });
});

describe("testRepoAccess — token never leaks through the real error path", () => {
  it("redacts the token from the error returned for an unreachable host", async () => {
    // Pure redactUrlCredentials is unit-tested elsewhere; this exercises the
    // full testRepoAccess -> runGit -> error path against a real git failure.
    const result = await testRepoAccess(
      "https://gitlab.invalid.localhost.test/group/project.git",
      "token",
      "glpat-MUSTNOTLEAK",
    );
    expect(result.ok).toBe(false);
    expect(result.error ?? "").not.toContain("glpat-MUSTNOTLEAK");
  }, 30000);
});
