import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldBossState, WildPokemon } from "../../../../shared/types.js";

type StoreModule = typeof import("../../src/storage/world-boss-store.js");

let tmpDir: string;
let store: StoreModule;

function makeWild(maxHp: number): WildPokemon {
  return {
    species: "mewtwo",
    variantId: null,
    level: 70,
    hp: maxHp,
    maxHp,
    stats: { attack: 100, defense: 90, spAttack: 154, spDefense: 90, speed: 130 },
    moves: [{ id: "psychic", pp: 10, maxPp: 10 }],
    nature: "hardy",
  };
}

function makeState(overrides: Partial<WorldBossState> = {}): WorldBossState {
  const now = new Date();
  return {
    active: true,
    bossId: "boss-1",
    species: "mewtwo",
    variantId: null,
    level: 70,
    name: "뮤츠",
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
    globalMaxHp: 100000,
    globalHp: 100000,
    defeated: false,
    rewardsDistributed: false,
    wild: makeWild(100000),
    contributions: {},
    attackFeed: [],
    chat: [],
    ...overrides,
  };
}

describe("world-boss-store", () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-world-boss-store-test-"));
    process.env.POKELOG_DATA_DIR = tmpDir;
    vi.resetModules();
    store = await import("../../src/storage/world-boss-store.js");
  });

  afterEach(() => {
    delete process.env.POKELOG_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null before any spawn", async () => {
    expect(await store.getWorldBoss()).toBeNull();
  });

  it("saves and reads back a spawned state", async () => {
    const state = makeState();
    await store.setWorldBoss(state);
    const read = await store.getWorldBoss();
    expect(read).not.toBeNull();
    expect(read!.bossId).toBe("boss-1");
    expect(read!.globalHp).toBe(100000);
  });

  it("mutateWorldBoss serializes concurrent read-modify-write (no lost updates)", async () => {
    await store.setWorldBoss(makeState({ globalHp: 1000 }));

    // 동시에 100번 각 10씩 차감 — 락이 없으면 read-modify-write 경합으로 값이 유실된다.
    await Promise.all(
      Array.from({ length: 100 }, () =>
        store.mutateWorldBoss((ws) => {
          ws.globalHp -= 10;
          return ws;
        }),
      ),
    );

    const final = await store.getWorldBoss();
    expect(final!.globalHp).toBe(0);
  });

  it("mutateWorldBoss returns null (and does not throw) when no boss exists", async () => {
    const result = await store.mutateWorldBoss((ws) => {
      ws.globalHp = 0;
      return ws;
    });
    expect(result).toBeNull();
  });

  it("endWorldBossIfExpired sets active=false past expiresAt for an undefeated boss", async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    await store.setWorldBoss(makeState({ expiresAt: past }));

    const result = await store.endWorldBossIfExpired(new Date());
    expect(result!.active).toBe(false);
  });

  it("endWorldBossIfExpired leaves an unexpired boss active", async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    await store.setWorldBoss(makeState({ expiresAt: future }));

    const result = await store.endWorldBossIfExpired(new Date());
    expect(result!.active).toBe(true);
  });

  it("endWorldBossIfExpired does not touch a defeated boss", async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    // 처치된 보스는 active 상태와 무관하게 손대지 않는다(보상 배분이 이미 끝났으므로).
    await store.setWorldBoss(makeState({ expiresAt: past, defeated: true, active: true }));

    const result = await store.endWorldBossIfExpired(new Date());
    expect(result!.active).toBe(true);
    expect(result!.defeated).toBe(true);
  });
});
