import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserData } from "../../../../shared/types.js";

/**
 * Lost-update regression: concurrent read-modify-write of the same user file
 * must not drop a write. Two mutators each read the user, bump a counter, and
 * save. Without serialization the second read sees the pre-first-write value and
 * overwrites it (final = +1 instead of +2). Under withLock(`user:id`) both apply.
 */

type UserStoreModule = typeof import("../../src/storage/user-store.js");
type PvpStoreModule = typeof import("../../src/storage/pvp-store.js");

let tmpDir: string;
let userStore: UserStoreModule;
let pvpStore: PvpStoreModule;

function createUser(id: string, overrides: Partial<UserData> = {}): UserData {
  return {
    account: { id, password: "pw", nickname: id, createdAt: "2026-04-13T00:00:00.000Z", matchings: {} },
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

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-lost-update-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  userStore = await import("../../src/storage/user-store.js");
  pvpStore = await import("../../src/storage/pvp-store.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("user RMW lost-update regression under withLock", () => {
  it("two concurrent point increments both land (no lost update)", async () => {
    await userStore.saveUser(createUser("ash", { points: 100 }));

    const bump = (by: number) =>
      pvpStore.withLock("user:ash", async () => {
        const user = await userStore.getUser("ash");
        if (!user) throw new Error("missing");
        // Force an await between read and write to widen the race window.
        await new Promise((r) => setTimeout(r, 10));
        user.points += by;
        await userStore.saveUser(user, "admin-adjust");
      });

    await Promise.all([bump(5), bump(7)]);

    const final = await userStore.getUser("ash");
    expect(final!.points).toBe(112); // 100 + 5 + 7, neither write lost
  });

  it("interleaved mutations to different fields both persist", async () => {
    await userStore.saveUser(createUser("misty", { points: 0, gameMoney: 0 }));

    const addPoints = pvpStore.withLock("user:misty", async () => {
      const u = await userStore.getUser("misty");
      await new Promise((r) => setTimeout(r, 10));
      u!.points += 50;
      await userStore.saveUser(u!, "admin-adjust");
    });
    const addMoney = pvpStore.withLock("user:misty", async () => {
      const u = await userStore.getUser("misty");
      await new Promise((r) => setTimeout(r, 10));
      u!.gameMoney += 30;
      await userStore.saveUser(u!, "admin-adjust");
    });

    await Promise.all([addPoints, addMoney]);

    const final = await userStore.getUser("misty");
    expect(final!.points).toBe(50);
    expect(final!.gameMoney).toBe(30);
  });

  it("many concurrent increments all land", async () => {
    await userStore.saveUser(createUser("brock", { points: 0 }));

    await Promise.all(
      Array.from({ length: 40 }, () =>
        pvpStore.withLock("user:brock", async () => {
          const u = await userStore.getUser("brock");
          u!.points += 1;
          await userStore.saveUser(u!, "admin-adjust");
        }),
      ),
    );

    const final = await userStore.getUser("brock");
    expect(final!.points).toBe(40);
  });
});
