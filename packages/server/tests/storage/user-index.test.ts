import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitIntegration, UserData } from "../../../../shared/types.js";

type UserStoreModule = typeof import("../../src/storage/user-store.js");

let tmpDir: string;
let store: UserStoreModule;

function createUser(id: string, overrides: Partial<UserData> = {}): UserData {
  return {
    account: {
      id,
      password: "pw",
      nickname: id,
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
    ...overrides,
  };
}

function gitIntegration(overrides: Partial<GitIntegration> = {}): GitIntegration {
  return {
    id: "int-1",
    provider: "git",
    label: "acme/repo",
    status: "ok",
    failCount: 0,
    addedAt: "2026-04-13T00:00:00.000Z",
    config: { repoUrl: "https://github.com/acme/repo" },
    emails: [],
    ...overrides,
  };
}

function indexFile(): string {
  return path.join(tmpDir, "users", "_index.json");
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-user-index-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  store = await import("../../src/storage/user-store.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("user index maintenance", () => {
  it("writes an index entry when a user is saved", async () => {
    await store.saveUser(
      createUser("ash", {
        account: {
          id: "ash",
          password: "pw",
          nickname: "Ash",
          createdAt: "2026-04-13T00:00:00.000Z",
          matchings: { git: { emails: ["ash@example.com"] } },
        },
      }),
    );

    const index = JSON.parse(fs.readFileSync(indexFile(), "utf-8"));
    expect(index.users.ash).toMatchObject({
      id: "ash",
      nickname: "ash",
      nicknameDisplay: "Ash",
      emails: ["ash@example.com"],
    });
  });

  it("getAllUsers ignores the index file", async () => {
    await store.saveUser(createUser("ash"));
    await store.saveUser(createUser("misty"));

    const users = await store.getAllUsers();
    expect(users.map((u) => u.account.id).sort()).toEqual(["ash", "misty"]);
  });

  it("removes a user from the index on delete", async () => {
    await store.saveUser(createUser("ash"));
    await store.deleteUser("ash");

    const index = JSON.parse(fs.readFileSync(indexFile(), "utf-8"));
    expect(index.users.ash).toBeUndefined();
    expect(await store.getUser("ash")).toBeNull();
  });

  it("still persists the user (without throwing) when the index update fails", async () => {
    const indexModule = await import("../../src/storage/user-index.js");
    const spy = vi
      .spyOn(indexModule, "updateUserIndex")
      .mockRejectedValue(new Error("disk full"));

    // saveUser must not reject even though the index update throws.
    await expect(store.saveUser(createUser("ash"))).resolves.toBeUndefined();
    // Guard against a no-op spy: the failure path must actually be exercised.
    expect(spy).toHaveBeenCalledTimes(1);
    // The user file (source of truth) is written regardless.
    expect((await store.getUser("ash"))?.account.id).toBe("ash");

    spy.mockRestore();
  });
});

describe("findUserByEmail / isEmailTaken", () => {
  it("resolves a user by their git matching email", async () => {
    await store.saveUser(
      createUser("ash", {
        account: {
          id: "ash",
          password: "pw",
          nickname: "Ash",
          createdAt: "2026-04-13T00:00:00.000Z",
          matchings: { git: { emails: ["ash@example.com"] } },
        },
      }),
    );
    await store.saveUser(createUser("misty"));

    const found = await store.findUserByEmail("ash@example.com");
    expect(found?.account.id).toBe("ash");
    expect(await store.isEmailTaken("ash@example.com")).toBe(true);
    expect(await store.isEmailTaken("nobody@example.com")).toBe(false);
    expect(await store.findUserByEmail("nobody@example.com")).toBeNull();
  });

  it("reflects email removal after re-save", async () => {
    const user = createUser("ash", {
      account: {
        id: "ash",
        password: "pw",
        nickname: "Ash",
        createdAt: "2026-04-13T00:00:00.000Z",
        matchings: { git: { emails: ["ash@example.com"] } },
      },
    });
    await store.saveUser(user);
    expect(await store.isEmailTaken("ash@example.com")).toBe(true);

    user.account.matchings.git = { emails: [] };
    await store.saveUser(user);
    expect(await store.isEmailTaken("ash@example.com")).toBe(false);
  });
});

describe("getUsersForRepoCommit", () => {
  it("matches by explicit integration email", async () => {
    await store.saveUser(
      createUser("ash", {
        integrations: [gitIntegration({ emails: ["ash@example.com"] })],
      }),
    );
    await store.saveUser(
      createUser("misty", {
        integrations: [
          gitIntegration({ id: "int-2", emails: ["misty@example.com"] }),
        ],
      }),
    );

    const matched = await store.getUsersForRepoCommit(
      "https://github.com/acme/repo",
      "ash@example.com",
    );
    expect(matched.map((u) => u.account.id)).toEqual(["ash"]);
  });

  it("treats an empty integration email list as a wildcard", async () => {
    await store.saveUser(
      createUser("ash", { integrations: [gitIntegration({ emails: [] })] }),
    );

    const matched = await store.getUsersForRepoCommit(
      "https://github.com/acme/repo/",
      "anyone@example.com",
    );
    expect(matched.map((u) => u.account.id)).toEqual(["ash"]);
  });

  it("excludes integrations in error or with too many failures", async () => {
    await store.saveUser(
      createUser("ash", {
        integrations: [gitIntegration({ emails: [], status: "error" })],
      }),
    );
    await store.saveUser(
      createUser("misty", {
        integrations: [gitIntegration({ id: "int-2", emails: [], failCount: 3 })],
      }),
    );

    const matched = await store.getUsersForRepoCommit(
      "https://github.com/acme/repo",
      "anyone@example.com",
    );
    expect(matched).toEqual([]);
  });

  it("falls back to legacy git matchings", async () => {
    await store.saveUser(
      createUser("ash", {
        account: {
          id: "ash",
          password: "pw",
          nickname: "Ash",
          createdAt: "2026-04-13T00:00:00.000Z",
          matchings: { git: { emails: ["legacy@example.com"] } },
        },
      }),
    );

    const matched = await store.getUsersForRepoCommit(
      "https://github.com/acme/repo",
      "legacy@example.com",
    );
    expect(matched.map((u) => u.account.id)).toEqual(["ash"]);
  });
});

describe("isRepoEmailTaken", () => {
  beforeEach(async () => {
    await store.saveUser(
      createUser("ash", {
        integrations: [gitIntegration({ emails: ["shared@example.com"] })],
      }),
    );
  });

  it("reports an email already registered for the repo", async () => {
    expect(
      await store.isRepoEmailTaken("https://github.com/acme/repo", "shared@example.com"),
    ).toBe(true);
  });

  it("returns false for a different email", async () => {
    expect(
      await store.isRepoEmailTaken("https://github.com/acme/repo", "other@example.com"),
    ).toBe(false);
  });

  it("ignores the excluded user/integration", async () => {
    expect(
      await store.isRepoEmailTaken(
        "https://github.com/acme/repo",
        "shared@example.com",
        "ash",
        "int-1",
      ),
    ).toBe(false);
  });
});

describe("index migration", () => {
  it("rebuilds the index from existing user files when missing", async () => {
    // Write a user file directly, bypassing saveUser so no index exists.
    const usersDir = path.join(tmpDir, "users");
    fs.mkdirSync(usersDir, { recursive: true });
    const legacy = createUser("ash", {
      account: {
        id: "ash",
        password: "pw",
        nickname: "Ash",
        createdAt: "2026-04-13T00:00:00.000Z",
        matchings: { git: { emails: ["ash@example.com"] } },
      },
    });
    fs.writeFileSync(path.join(usersDir, "ash.json"), JSON.stringify(legacy));
    expect(fs.existsSync(indexFile())).toBe(false);

    // First index-backed lookup triggers a rebuild.
    const found = await store.findUserByEmail("ash@example.com");
    expect(found?.account.id).toBe("ash");
    expect(fs.existsSync(indexFile())).toBe(true);
  });
});

describe("concurrent index writes", () => {
  // Reproduces the trade-accept path (trade.ts: Promise.all([saveUser(requester),
  // saveUser(responder)])). Before withIndexLock, the two interleaved
  // read-modify-write cycles on the shared _index.json clobbered each other (and
  // raced the atomic rename into EPERM on Windows). The lock must serialize them
  // so every concurrently-saved user survives in the final index.
  it("keeps every entry when many users are saved concurrently", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `trainer${i}`);

    await Promise.all(ids.map((id) => store.saveUser(createUser(id))));

    const index = JSON.parse(fs.readFileSync(indexFile(), "utf-8"));
    expect(Object.keys(index.users).sort()).toEqual([...ids].sort());
  });

  it("does not lose a previously-indexed user when two saves race", async () => {
    // Seed one user, then fire two concurrent saves of two different users.
    // A lost-update on the index would drop the seeded entry or one of the two.
    await store.saveUser(createUser("seed"));

    await Promise.all([
      store.saveUser(createUser("ash")),
      store.saveUser(createUser("misty")),
    ]);

    const index = JSON.parse(fs.readFileSync(indexFile(), "utf-8"));
    expect(Object.keys(index.users).sort()).toEqual(["ash", "misty", "seed"]);
  });
});
