import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import type { GitIntegration } from "../../../../shared/types.js";

const exec = promisify(execFile);

/**
 * Verifies the security UX around insecureSkipTls: the connection test surfaces
 * a user-facing warning when TLS verification is disabled, and that disabling it
 * does not break a working (local) repo connection.
 */
describe("testIntegrationConnection — insecureSkipTls warning", () => {
  let dataDir: string;
  let sourceRepo: string;
  let repoUrl: string;

  beforeEach(async () => {
    dataDir = path.join(os.tmpdir(), `pokelog-tlswarn-data-${randomUUID()}`);
    fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
    process.env.POKELOG_DATA_DIR = dataDir;

    sourceRepo = path.join(os.tmpdir(), `pokelog-tlswarn-src-${randomUUID()}`);
    await fsp.mkdir(sourceRepo, { recursive: true });
    await exec("git", ["init", "--initial-branch=main"], { cwd: sourceRepo });
    await exec("git", ["config", "user.email", "dev@corp.example"], { cwd: sourceRepo });
    await exec("git", ["config", "user.name", "Dev"], { cwd: sourceRepo });
    await fsp.writeFile(path.join(sourceRepo, "f.txt"), "x\n");
    await exec("git", ["add", "-A"], { cwd: sourceRepo });
    await exec("git", ["commit", "-m", "init"], { cwd: sourceRepo });
    repoUrl = pathToFileURL(sourceRepo).toString();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(sourceRepo, { recursive: true, force: true });
    delete process.env.POKELOG_DATA_DIR;
  });

  function makeGitIntegration(insecureSkipTls: boolean): GitIntegration {
    return {
      id: "git1",
      provider: "gitlab",
      label: "corp",
      status: "untested",
      failCount: 0,
      addedAt: new Date().toISOString(),
      config: { repoUrl, authMode: "public", insecureSkipTls },
      emails: ["dev@corp.example"],
    };
  }

  it("warns the user when insecureSkipTls is enabled", async () => {
    const { testIntegrationConnection } = await import(
      "../../src/integrations/provider-tests.js"
    );
    const result = await testIntegrationConnection(makeGitIntegration(true));
    expect(result.ok).toBe(true);
    expect(result.warning ?? "").toContain("insecureSkipTls");
  });

  it("does not emit the TLS warning when verification is on", async () => {
    const { testIntegrationConnection } = await import(
      "../../src/integrations/provider-tests.js"
    );
    const result = await testIntegrationConnection(makeGitIntegration(false));
    expect(result.ok).toBe(true);
    expect(result.warning ?? "").not.toContain("insecureSkipTls");
  });
});
