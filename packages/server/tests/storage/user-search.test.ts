import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserData } from "../../../../shared/types.js";

type UserStoreModule = typeof import("../../src/storage/user-store.js");

let tmpDir: string;
let userStoreModule: UserStoreModule;

function createUser(id: string, nickname: string): UserData {
  return {
    account: {
      id,
      password: "pw",
      nickname,
      createdAt: "2026-04-13T00:00:00.000Z",
      matchings: {},
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
    integrations: [],
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-user-search-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  userStoreModule = await import("../../src/storage/user-store.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("searchUsersByIdentity", () => {
  it("searches by id and nickname while excluding the current user", async () => {
    await userStoreModule.saveUser(createUser("ash", "Ash"));
    await userStoreModule.saveUser(createUser("misty", "Misty"));
    await userStoreModule.saveUser(createUser("brock", "RockSolid"));

    const byId = await userStoreModule.searchUsersByIdentity("mis", { excludeUserId: "ash" });
    const byNickname = await userStoreModule.searchUsersByIdentity("rock", { excludeUserId: "ash" });

    expect(byId.map((user) => user.id)).toEqual(["misty"]);
    expect(byNickname.map((user) => user.id)).toEqual(["brock"]);
  });

  it("ranks exact matches ahead of partial matches", async () => {
    await userStoreModule.saveUser(createUser("pikachu", "Sparky"));
    await userStoreModule.saveUser(createUser("pika-fan", "PikachuLover"));

    const results = await userStoreModule.searchUsersByIdentity("pikachu");

    expect(results[0]?.id).toBe("pikachu");
  });

  it("prefers exact nickname match over exact id match", async () => {
    // One user's id is "target-query"; a different user's nickname
    // matches "target-query" exactly. Exact id match scores 100, exact
    // nickname match scores 95 — id wins.
    await userStoreModule.saveUser(createUser("target-query", "SomeoneElse"));
    await userStoreModule.saveUser(createUser("other-id", "target-query"));

    const results = await userStoreModule.searchUsersByIdentity("target-query");

    // Both should appear, with the exact-id match first.
    expect(results.map((u) => u.id)).toEqual(["target-query", "other-id"]);
  });

  it("prefers exact nickname match over prefix / substring matches", async () => {
    await userStoreModule.saveUser(createUser("dragonite", "SomeOtherName"));
    await userStoreModule.saveUser(createUser("dragonair", "Dragon")); // exact nickname
    await userStoreModule.saveUser(createUser("dratini", "DragonTamer"));

    const results = await userStoreModule.searchUsersByIdentity("dragon");

    // dragonair is exact nickname match (score 95), others are prefix
    // (score 80). dragonair comes first.
    expect(results[0]?.id).toBe("dragonair");
  });

  it("breaks ties by id lexicographic order (stable)", async () => {
    // All three have the same kind of prefix nickname match → same
    // score. Tie-break falls to id ascending.
    await userStoreModule.saveUser(createUser("charlie", "RockClimber"));
    await userStoreModule.saveUser(createUser("alice", "RockStar"));
    await userStoreModule.saveUser(createUser("bob", "RockBand"));

    const results = await userStoreModule.searchUsersByIdentity("rock");

    expect(results.map((u) => u.id)).toEqual(["alice", "bob", "charlie"]);
  });

  it("ranks prefix match above substring match (fuzzy)", async () => {
    await userStoreModule.saveUser(createUser("prefixmatch", "Someone"));
    await userStoreModule.saveUser(createUser("has-prefix-inside", "Other"));

    const results = await userStoreModule.searchUsersByIdentity("prefix");
    expect(results[0]?.id).toBe("prefixmatch");
  });
});
