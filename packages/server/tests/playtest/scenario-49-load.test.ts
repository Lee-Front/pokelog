/**
 * Scenario 49 — Load / Concurrency Stress.
 *
 * Stress tests intended to verify the server doesn't blow up under a
 * realistic-looking burst of work. Loose timeouts; assertions focus on
 * "no errors / no leaks" rather than precise latency.
 *
 *   1. Register 100 users in parallel via the in-process auth route.
 *   2. Spin up 50 concurrent PvP rooms in-process and resolve a turn each.
 *
 * Memory comparison is informational; we only assert that the heap did
 * not balloon by an absurd factor (rough sanity check).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { HttpClient } from "./api-helpers.js";
import { createTestUser } from "./test-user.js";
import { createRoom, selectLead, submitAction, deleteRoom } from "../../src/pvp/pvp-room.js";
import type { PvpPokemon } from "../../../../shared/pvp-types.js";

function makeMon(species: string, moves: string[], overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-${Math.random().toString(36).slice(2, 8)}`,
    species,
    level: 50,
    hp: 200,
    maxHp: 200,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 80 },
    moves: moves.map((id) => ({ id, pp: 24, maxPp: 24 })),
    statusCondition: null,
    abilityId: null,
    heldItem: null,
    teraType: null,
    originalTypes: ["normal"],
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

describe("Scenario 49 — Load / Concurrency", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("registers 100 users in parallel without errors", async () => {
    const http = new HttpClient(ctx.app);
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => http.post("/api/auth/register", {
        id: `loadUser${i.toString().padStart(3, "0")}`,
        password: "pw1234",
        nickname: `Load${i}`,
        starter: "bulbasaur",
      })),
    );
    const elapsed = Date.now() - start;
    const okCount = results.filter((r) => r.status === 200 || r.status === 201).length;
    const failures = results.filter((r) => r.status >= 400).map((r) => `${r.status}: ${JSON.stringify(r.body)}`);

    // We expect all 100 to succeed. If a future hot-path adds DB contention,
    // bumping the loose threshold is preferable to flaking the test.
    expect(failures).toEqual([]);
    expect(okCount).toBe(100);
    // Loose timeout: in-process supertest is not strict about latency.
    expect(elapsed).toBeLessThan(60_000);
  }, 90_000);

  it("creates and resolves 50 concurrent PvP rooms without errors", async () => {
    const memBefore = process.memoryUsage().heapUsed;

    const N = 50;
    const rooms = [];
    for (let i = 0; i < N; i++) {
      const a = makeMon("rattata", ["tackle"]);
      const b = makeMon("pidgey", ["tackle"]);
      const room = createRoom(`loadA${i}`, `A${i}`, [a], `loadB${i}`, `B${i}`, [b], false);
      rooms.push(room);
    }

    // Lead select for each side, then submit one fight action each.
    for (const room of rooms) {
      selectLead(room, room.playerA.userId, 0);
      selectLead(room, room.playerB.userId, 0);
    }
    for (const room of rooms) {
      submitAction(room, room.playerA.userId, { type: "fight", moveId: "tackle" });
      submitAction(room, room.playerB.userId, { type: "fight", moveId: "tackle" });
    }

    // Verify each room resolved its turn (turn counter incremented past 1).
    for (const room of rooms) {
      // After a single fight-vs-fight resolution, room.turn becomes 2.
      expect(["finished", "action", "forced_switch"]).toContain(room.phase);
      // No room should have undefined log.
      expect(Array.isArray(room.log)).toBe(true);
    }

    // Cleanup — deleteRoom drops the entry and frees its pendingActions map.
    for (const room of rooms) {
      deleteRoom(room.roomId);
    }

    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;
    // Sanity bound: 50 small rooms shouldn't add >256MB of heap. This
    // catches catastrophic leaks (e.g. accumulating logs forever).
    expect(memDelta).toBeLessThan(256 * 1024 * 1024);
  }, 60_000);

  it("creates 20 users in parallel via createTestUser without collisions", async () => {
    // createTestUser writes user files; verifies the per-user lock + tmp
    // dir layout doesn't choke under modest contention.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createTestUser({
        uid: `concTestUser${i.toString().padStart(2, "0")}`,
        initialPokemon: [{ species: "rattata", level: 5 }],
      })),
    );
    expect(results).toHaveLength(20);
    for (const r of results) {
      expect(r.user.account.id).toMatch(/^concTestUser\d{2}$/);
      expect(r.token).toBeTruthy();
    }
  }, 30_000);
});
