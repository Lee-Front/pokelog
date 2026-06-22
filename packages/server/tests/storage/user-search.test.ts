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
});
