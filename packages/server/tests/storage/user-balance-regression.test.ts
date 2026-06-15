import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserData } from "../../../../shared/types.js";

/**
 * #19 diagnostic: saveUser must emit a WARNING when a save lowers points or
 * totalExp below the value already on disk (the signature of a stale-save
 * overwrite), and must stay quiet for normal increases and for intentional
 * debits that pass a `reason`.
 */

const warn = vi.fn();
vi.mock("../../src/logger.js", () => ({
  childLogger: () => ({
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

type UserStoreModule = typeof import("../../src/storage/user-store.js");

let tmpDir: string;
let store: UserStoreModule;

function createUser(id: string, overrides: Partial<UserData> = {}): UserData {
  return {
    account: { id, password: "pw", nickname: id, createdAt: "2026-04-13T00:00:00.000Z", matchings: {} },
    currentRegion: "default",
    points: 100,
    battleMoney: 0,
    totalExp: 500,
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-bal-reg-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();
  warn.mockClear();
  store = await import("../../src/storage/user-store.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveUser balance-regression warning (#19)", () => {
  it("warns when points drop below the on-disk value", async () => {
    await store.saveUser(createUser("ash", { points: 100 }));
    warn.mockClear();

    await store.saveUser(createUser("ash", { points: 30 })); // regression
    const regressionWarns = warn.mock.calls.filter(
      ([meta]) => meta && meta.field === "points",
    );
    expect(regressionWarns.length).toBe(1);
    expect(regressionWarns[0][0]).toMatchObject({ userId: "ash", before: 100, after: 30 });
    expect(typeof regressionWarns[0][0].stack).toBe("string");
  });

  it("warns when totalExp drops below the on-disk value", async () => {
    await store.saveUser(createUser("ash", { totalExp: 500 }));
    warn.mockClear();

    await store.saveUser(createUser("ash", { totalExp: 10 }));
    const expWarns = warn.mock.calls.filter(([meta]) => meta && meta.field === "totalExp");
    expect(expWarns.length).toBe(1);
  });

  it("does not warn on a normal increase", async () => {
    await store.saveUser(createUser("ash", { points: 100, totalExp: 500 }));
    warn.mockClear();

    await store.saveUser(createUser("ash", { points: 160, totalExp: 800 }));
    const regressionWarns = warn.mock.calls.filter(
      ([meta]) => meta && (meta.field === "points" || meta.field === "totalExp"),
    );
    expect(regressionWarns.length).toBe(0);
  });

  it("does not warn for an intentional debit (shop-purchase)", async () => {
    await store.saveUser(createUser("ash", { points: 100 }));
    warn.mockClear();

    await store.saveUser(createUser("ash", { points: 40 }), "shop-purchase");
    const regressionWarns = warn.mock.calls.filter(([meta]) => meta && meta.field === "points");
    expect(regressionWarns.length).toBe(0);
  });

  it("does not warn for an intentional debit (admin-recompute)", async () => {
    // recompute resets a balance to its commit-derived value, which can be
    // lower than the prior (non-commit-inclusive) balance; this drop is intended.
    await store.saveUser(createUser("ash", { points: 100, totalExp: 500 }));
    warn.mockClear();

    await store.saveUser(createUser("ash", { points: 20, totalExp: 80 }), "admin-recompute");
    const regressionWarns = warn.mock.calls.filter(
      ([meta]) => meta && (meta.field === "points" || meta.field === "totalExp"),
    );
    expect(regressionWarns.length).toBe(0);
  });

  it("does not warn on the first save (no prior file)", async () => {
    await store.saveUser(createUser("brandnew", { points: 0, totalExp: 0 }));
    const regressionWarns = warn.mock.calls.filter(
      ([meta]) => meta && (meta.field === "points" || meta.field === "totalExp"),
    );
    expect(regressionWarns.length).toBe(0);
  });
});
