/**
 * Scenario 21 — Realtime PvP Full Cycle.
 *
 * Two real Socket.IO clients connect, authenticate, queue, get matched,
 * select leads, and exchange a few turns. We don't need to play the
 * battle to completion — the goal is to validate the matchmaker → room
 * → action flow end-to-end with two simultaneous clients (the AI-battle
 * E2E test only covers single-client plumbing).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { createPvpClient, type PvpClientHandle } from "./api-helpers.js";

describe("Scenario 21 — Realtime PvP Full Cycle", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("two clients queue, get matched, and exchange a turn", async () => {
    const A = await createTestUser({
      uid: "pvpUserA",
      initialPokemon: [
        { species: "pikachu", level: 50 },
        { species: "blastoise", level: 50 },
        { species: "venusaur", level: 50 },
      ],
    });
    const B = await createTestUser({
      uid: "pvpUserB",
      initialPokemon: [
        { species: "charmander", level: 50 },
        { species: "snorlax", level: 50 },
        { species: "alakazam", level: 50 },
      ],
    });

    const mock = vi.spyOn(Math, "random").mockReturnValue(0.5);
    let clientA: PvpClientHandle | null = null;
    let clientB: PvpClientHandle | null = null;
    try {
      clientA = await createPvpClient(ctx.baseUrl, A.token);
      clientB = await createPvpClient(ctx.baseUrl, B.token);

      // Set up matched listeners BEFORE sending queue events to avoid races.
      const matchedA = clientA.waitFor<{ roomId: string; opponent: string }>("pvp:matched", 10_000);
      const matchedB = clientB.waitFor<{ roomId: string; opponent: string }>("pvp:matched", 10_000);

      await clientA.emit("pvp:queue");
      await clientB.emit("pvp:queue");

      const [matchA, matchB] = await Promise.all([matchedA, matchedB]);
      expect(matchA.roomId).toBe(matchB.roomId);
      expect(matchA.opponent).toBe("pvpUserB");
      expect(matchB.opponent).toBe("pvpUserA");

      // Both clients should also have received an initial room_state via
      // the matchmaker handler. Listen for the next turn_result after we
      // submit actions below.
      const turnA = clientA.waitFor("pvp:turn_result", 10_000);
      const turnB = clientB.waitFor("pvp:turn_result", 10_000);

      await clientA.emit("pvp:select_lead", { pokemonIndex: 0 });
      await clientB.emit("pvp:select_lead", { pokemonIndex: 0 });

      // Submit a fight action from each side. We pick the first move id
      // available on the lead pokemon — which we can pull from the local
      // user data we just created.
      const moveA = A.user.pokemon[0].moves[0]?.id ?? "tackle";
      const moveB = B.user.pokemon[0].moves[0]?.id ?? "tackle";
      await clientA.emit("pvp:action", { action: { type: "fight", moveId: moveA } });
      await clientB.emit("pvp:action", { action: { type: "fight", moveId: moveB } });

      const [resA, resB] = await Promise.all([turnA, turnB]);
      expect(resA).toBeDefined();
      expect(resB).toBeDefined();
    } finally {
      mock.mockRestore();
      clientA?.close();
      clientB?.close();
    }
  }, 20_000);

  it("queue cancel removes user from matchmaking", async () => {
    const A = await createTestUser({
      uid: "pvpCancelA",
      initialPokemon: [{ species: "pikachu", level: 50 }],
    });
    let clientA: PvpClientHandle | null = null;
    try {
      clientA = await createPvpClient(ctx.baseUrl, A.token);

      const queued = clientA.waitFor("pvp:queued", 5000);
      await clientA.emit("pvp:queue");
      await queued;

      // Now cancel — there should be no errors and the next queue should
      // succeed cleanly.
      await clientA.emit("pvp:queue_cancel");

      const queuedAgain = clientA.waitFor("pvp:queued", 5000);
      await clientA.emit("pvp:queue");
      await queuedAgain;
    } finally {
      clientA?.close();
    }
  });
});
