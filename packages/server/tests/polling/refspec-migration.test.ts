import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { fetchRepo, getNewCommits, getLatestHash } from "../../src/polling/git-client.js";

const exec = promisify(execFile);

/**
 * Regression for the refspec migration gap: bare clones created before the
 * refspec fix have no remote.origin.fetch, so origin/<branch> never resolves
 * and polling silently returns nothing. fetchRepo must repair such clones
 * idempotently on the next poll without a re-clone.
 */
describe("refspec migration (pre-existing bare clones)", () => {
  let sourceRepo: string;
  let bareDir: string;

  beforeEach(async () => {
    sourceRepo = path.join(os.tmpdir(), `pokelog-refspec-src-${randomUUID()}`);
    bareDir = path.join(os.tmpdir(), `pokelog-refspec-bare-${randomUUID()}.git`);
    await fs.mkdir(sourceRepo, { recursive: true });
    await exec("git", ["init", "--initial-branch=main"], { cwd: sourceRepo });
    await exec("git", ["config", "user.email", "dev@corp.example"], { cwd: sourceRepo });
    await exec("git", ["config", "user.name", "Dev"], { cwd: sourceRepo });
    await fs.writeFile(path.join(sourceRepo, "f.txt"), "hello\n");
    await exec("git", ["add", "-A"], { cwd: sourceRepo });
    await exec("git", ["commit", "-m", "first"], { cwd: sourceRepo });

    // Clone the OLD way: plain bare clone with no fetch refspec, simulating a
    // repo created before the fix.
    const url = pathToFileURL(sourceRepo).toString();
    await exec("git", ["clone", "--bare", url, bareDir]);
  });

  afterEach(async () => {
    await fs.rm(sourceRepo, { recursive: true, force: true });
    await fs.rm(bareDir, { recursive: true, force: true });
  });

  it("a legacy bare clone cannot resolve origin/<branch> before repair", async () => {
    // Sanity check that the pre-fix state is actually broken.
    const refspec = await exec("git", ["config", "--get", "remote.origin.fetch"], {
      cwd: bareDir,
    }).then((r) => r.stdout.trim()).catch(() => "");
    expect(refspec).toBe("");

    const commits = await getNewCommits(bareDir, "main", null);
    expect(commits.length).toBe(0); // broken: origin/main does not resolve
  });

  it("fetchRepo idempotently installs the refspec and makes the repo readable", async () => {
    await fetchRepo(bareDir);

    const refspec = (
      await exec("git", ["config", "--get", "remote.origin.fetch"], { cwd: bareDir })
    ).stdout.trim();
    expect(refspec).toBe("+refs/heads/*:refs/remotes/origin/*");

    const commits = await getNewCommits(bareDir, "main", null);
    expect(commits.length).toBe(1);

    const latest = await getLatestHash(bareDir, "main");
    expect(latest).toBe(commits[0].hash);

    // Calling again must remain a no-op (idempotent) and still resolve.
    await fetchRepo(bareDir);
    const again = await getNewCommits(bareDir, "main", null);
    expect(again.length).toBe(1);
  });
});
