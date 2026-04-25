import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserData } from "../../../../shared/types.js";

type UserStoreModule = typeof import("../../src/storage/user-store.js");

let tmpDir: string;
let userStoreModule: UserStoreModule;

function createUser(id: string, nickname: string, opts: {
  gitEmails?: string[];
  integrations?: UserData["integrations"];
} = {}): UserData {
  return {
    account: {
      id,
      password: "pw",
      nickname,
      createdAt: "2026-04-24T00:00:00.000Z",
      matchings: opts.gitEmails ? { git: { emails: opts.gitEmails } } : {},
    },
    currentRegion: "default",
    points: 0,
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
    integrations: opts.integrations ?? [],
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-user-index-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  // Force a fresh module instance so the in-memory index starts clean
  // against the new tmp dir.
  vi.resetModules();
  userStoreModule = await import("../../src/storage/user-store.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("user index: initial build on first lookup", () => {
  it("finds a user by email after writing the file directly (pre-existing data)", async () => {
    // Simulate a user that already exists on disk before the process starts —
    // the index should build lazily on first lookup and pick this user up.
    const ash = createUser("ash", "Ash", { gitEmails: ["ash@pkmn.dev"] });
    fs.mkdirSync(path.join(tmpDir, "users"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "users", "ash.json"),
      JSON.stringify(ash),
    );

    const found = await userStoreModule.findUserByEmail("ash@pkmn.dev");
    expect(found?.account.id).toBe("ash");

    const taken = await userStoreModule.isEmailTaken("ash@pkmn.dev");
    expect(taken).toBe(true);

    const miss = await userStoreModule.findUserByEmail("not-registered@pkmn.dev");
    expect(miss).toBeNull();
  });
});

describe("user index: incremental updates on saveUser", () => {
  it("picks up new users without touching disk for lookups", async () => {
    await userStoreModule.saveUser(createUser("misty", "Misty", { gitEmails: ["misty@pkmn.dev"] }));
    await userStoreModule.saveUser(createUser("brock", "Brock", { gitEmails: ["brock@pkmn.dev"] }));

    expect((await userStoreModule.findUserByEmail("misty@pkmn.dev"))?.account.id).toBe("misty");
    expect((await userStoreModule.findUserByEmail("brock@pkmn.dev"))?.account.id).toBe("brock");
  });

  it("reflects email changes from a subsequent saveUser", async () => {
    await userStoreModule.saveUser(createUser("ash", "Ash", { gitEmails: ["old@pkmn.dev"] }));
    expect(await userStoreModule.isEmailTaken("old@pkmn.dev")).toBe(true);

    // User updates their matched email — the index must forget the old one.
    await userStoreModule.saveUser(createUser("ash", "Ash", { gitEmails: ["new@pkmn.dev"] }));
    expect(await userStoreModule.isEmailTaken("old@pkmn.dev")).toBe(false);
    expect(await userStoreModule.isEmailTaken("new@pkmn.dev")).toBe(true);
  });
});

describe("user index: searchUsersByIdentity", () => {
  it("returns matches from the index with the expected ranking", async () => {
    await userStoreModule.saveUser(createUser("pikachu", "Sparky"));
    await userStoreModule.saveUser(createUser("pikafan", "PikachuLover"));

    const results = await userStoreModule.searchUsersByIdentity("pikachu");
    // Exact id-match ("pikachu") outranks nickname-contains ("PikachuLover").
    expect(results[0]?.id).toBe("pikachu");
    expect(results.map((r) => r.id)).toContain("pikafan");
  });
});

describe("user index: isRepoEmailTaken respects exclude", () => {
  it("returns true when another user's integration already owns the email", async () => {
    await userStoreModule.saveUser(createUser("ash", "Ash", {
      integrations: [{
        id: "integ-1",
        provider: "github",
        label: "ash/repo",
        status: "ok",
        failCount: 0,
        addedAt: "2026-04-24T00:00:00.000Z",
        config: { repoUrl: "https://github.com/ash/repo" },
        emails: ["ash@pkmn.dev"],
      }],
    }));

    const taken = await userStoreModule.isRepoEmailTaken(
      "https://github.com/ash/repo",
      "ash@pkmn.dev",
    );
    expect(taken).toBe(true);
  });

  it("skips the caller's own integration when exclude ids are provided", async () => {
    await userStoreModule.saveUser(createUser("ash", "Ash", {
      integrations: [{
        id: "integ-1",
        provider: "github",
        label: "ash/repo",
        status: "ok",
        failCount: 0,
        addedAt: "2026-04-24T00:00:00.000Z",
        config: { repoUrl: "https://github.com/ash/repo" },
        emails: ["ash@pkmn.dev"],
      }],
    }));

    // Same user editing their own integration: the email is "their own", so
    // the uniqueness check should ignore it.
    const taken = await userStoreModule.isRepoEmailTaken(
      "https://github.com/ash/repo",
      "ash@pkmn.dev",
      "ash",
      "integ-1",
    );
    expect(taken).toBe(false);
  });
});
