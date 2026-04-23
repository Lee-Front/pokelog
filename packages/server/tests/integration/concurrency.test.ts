import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Task 3.3 — Concurrency regression tests.
 *
 * The project uses per-user JSON file storage. Concurrent read-modify-
 * write flows on the SAME user file are known to lose updates because
 * there is no mutex (documented in docs/known-limitations.md). These
 * tests pin the current behavior: independent writes across distinct
 * users are safe, and same-user concurrent writes lose at least one
 * update. If we ever add a per-user mutex, the "same user" test should
 * be flipped to assert merged state.
 */

describe("Concurrency — file storage behavior", () => {
  let dataDir: string;
  let getUserFn: typeof import("../../src/storage/user-store.js").getUser;
  let saveUserFn: typeof import("../../src/storage/user-store.js").saveUser;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `pokelog-concurrency-${randomUUID()}`);
    fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        meta: { name: "Concurrency Test", region: "kanto" },
        polling: { intervalMinutes: 5 },
        rewards: {
          expPerByte: 0.01,
          pointsPerByte: 0.005,
          encounter: { baseChance: 0.3, ceilingBytes: 1000, timeLimitHours: 168 },
        },
      }),
    );
    process.env.POKELOG_DATA_DIR = dataDir;

    const mod = await import("../../src/storage/user-store.js");
    getUserFn = mod.getUser;
    saveUserFn = mod.saveUser;
  });

  afterAll(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.POKELOG_DATA_DIR;
  });

  function makeBaseUser(id: string) {
    return {
      account: {
        id,
        password: "x",
        nickname: id,
        createdAt: new Date().toISOString(),
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
    } as Parameters<typeof saveUserFn>[0];
  }

  it("concurrent saveUser on same user can lose updates (known limitation)", async () => {
    const uid = "race_same_" + randomUUID().slice(0, 8);
    await saveUserFn(makeBaseUser(uid));

    // Two RMW cycles race. Neither locks, neither merges. The final
    // points value is one of the two writers', never "additive".
    // On Windows, concurrent fs.rename to the same destination can ALSO
    // throw EPERM — this itself is a known limitation (see
    // docs/known-limitations.md). We swallow that here so the test
    // documents the semantic lost-update behavior regardless of OS.
    const results = await Promise.allSettled([
      (async () => {
        const u = await getUserFn(uid);
        if (!u) throw new Error("missing user");
        u.points = 100;
        await saveUserFn(u);
      })(),
      (async () => {
        const u = await getUserFn(uid);
        if (!u) throw new Error("missing user");
        u.points = 200;
        await saveUserFn(u);
      })(),
    ]);
    // At least one write must have succeeded.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);

    const final = await getUserFn(uid);
    // The value is one of the two writers — we do NOT see an additive 300.
    expect([100, 200]).toContain(final!.points);
    expect(final!.points).not.toBe(300);
  });

  it("concurrent saveUser on distinct users is safe (independent files)", async () => {
    const uidA = "race_ind_a_" + randomUUID().slice(0, 6);
    const uidB = "race_ind_b_" + randomUUID().slice(0, 6);
    await saveUserFn(makeBaseUser(uidA));
    await saveUserFn(makeBaseUser(uidB));

    await Promise.all([
      (async () => {
        const u = await getUserFn(uidA);
        u!.points = 111;
        await saveUserFn(u!);
      })(),
      (async () => {
        const u = await getUserFn(uidB);
        u!.points = 222;
        await saveUserFn(u!);
      })(),
    ]);

    const [a, b] = await Promise.all([getUserFn(uidA), getUserFn(uidB)]);
    expect(a!.points).toBe(111);
    expect(b!.points).toBe(222);
  });

  it("writeJson never produces a torn/unparseable file on disk", async () => {
    // Smoke check: spam writes in parallel. Some may throw on Windows
    // (concurrent rename to same destination → EPERM), but whenever the
    // file IS present on disk it must always be valid JSON — the atomic
    // tmp + rename dance guarantees no partial writes leak through.
    const uid = "race_atomic_" + randomUUID().slice(0, 6);
    await saveUserFn(makeBaseUser(uid));
    const userFile = path.join(dataDir, "users", `${uid}.json`);

    await Promise.allSettled(
      Array.from({ length: 20 }, async (_, i) => {
        const u = await getUserFn(uid);
        if (!u) return;
        u.points = i;
        await saveUserFn(u);
      }),
    );

    const raw = fs.readFileSync(userFile, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as { points: number };
    expect(parsed.points).toBeGreaterThanOrEqual(0);
    expect(parsed.points).toBeLessThan(20);
  });
});
