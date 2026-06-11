import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Locks the registration parser for git/gitlab integrations, in particular that
 * the self-hosted-GitLab TLS options (caCertPath / insecureSkipTls) survive
 * registration so the polling worker and testRepoAccess can apply them.
 */
describe("parseIntegrationInput (git/gitlab TLS config)", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = path.join(os.tmpdir(), `pokelog-git-parser-${randomUUID()}`);
    fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
    process.env.POKELOG_DATA_DIR = dataDir;
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.POKELOG_DATA_DIR;
  });

  async function parse(body: Record<string, unknown>) {
    const { parseIntegrationInput } = await import(
      "../../src/integrations/integration-parsers.js"
    );
    return parseIntegrationInput(body, "user1", undefined) as Promise<any>;
  }

  it("preserves caCertPath and insecureSkipTls for a gitlab integration", async () => {
    const res = await parse({
      provider: "gitlab",
      label: "corp",
      config: {
        repoUrl: "https://gitlab.internal.corp/g/p.git",
        authMode: "token",
        token: "glpat-abc",
        caCertPath: "/etc/ssl/corp-ca.pem",
        insecureSkipTls: true,
      },
      emails: ["dev@corp.example"],
    });
    expect(res.error).toBeUndefined();
    expect(res.integration.config.caCertPath).toBe("/etc/ssl/corp-ca.pem");
    expect(res.integration.config.insecureSkipTls).toBe(true);
  });

  it("omits TLS fields when not provided", async () => {
    const res = await parse({
      provider: "gitlab",
      config: { repoUrl: "https://gitlab.internal.corp/g/p.git", authMode: "public" },
    });
    expect(res.error).toBeUndefined();
    expect(res.integration.config.caCertPath).toBeUndefined();
    expect(res.integration.config.insecureSkipTls).toBeUndefined();
  });

  it("ignores a non-boolean insecureSkipTls and blank caCertPath", async () => {
    const res = await parse({
      provider: "gitlab",
      config: {
        repoUrl: "https://gitlab.internal.corp/g/p.git",
        authMode: "public",
        caCertPath: "   ",
        insecureSkipTls: "yes",
      },
    });
    expect(res.error).toBeUndefined();
    expect(res.integration.config.caCertPath).toBeUndefined();
    expect(res.integration.config.insecureSkipTls).toBeUndefined();
  });
});
