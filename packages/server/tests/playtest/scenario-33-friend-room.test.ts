/**
 * Scenario 33 — Friend Room PvP.
 *
 *  - A creates a room (pvp:create_room) → roomId returned
 *  - B joins (pvp:join_room) → both receive room_state with each other
 *  - Joining a non-existent room emits pvp:error
 *  - Joining a room that has already been filled also fails
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createTestUser } from "./test-user.js";
import { createPvpClient, type PvpClientHandle } from "./api-helpers.js";

describe("Scenario 33 — Friend Room PvP", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("A creates a room and B joins; both receive room_state", async () => {
    const A = await createTestUser({
      uid: "friendRoomA", nickname: "RoomA",
      initialPokemon: [{ species: "pikachu", level: 50 }, { species: "blastoise", level: 50 }, { species: "venusaur", level: 50 }],
    });
    const B = await createTestUser({
      uid: "friendRoomB", nickname: "RoomB",
      initialPokemon: [{ species: "snorlax", level: 50 }, { species: "alakazam", level: 50 }, { species: "charizard", level: 50 }],
    });

    let clientA: PvpClientHandle | null = null;
    let clientB: PvpClientHandle | null = null;
    try {
      clientA = await createPvpClient(ctx.baseUrl, A.token);
      clientB = await createPvpClient(ctx.baseUrl, B.token);

      const created = clientA.waitFor<{ roomId: string }>("pvp:room_created", 5000);
      await clientA.emit("pvp:create_room");
      const { roomId } = await created;
      expect(roomId).toMatch(/[a-f0-9-]{8,}/i);

      const stateA = clientA.waitFor("pvp:room_state", 5000);
      const stateB = clientB.waitFor("pvp:room_state", 5000);
      await clientB.emit("pvp:join_room", { roomId });

      const [a, b] = await Promise.all([stateA, stateB]);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
    } finally {
      clientA?.close();
      clientB?.close();
    }
  }, 15_000);

  it("Joining an unknown room → pvp:error", async () => {
    const B = await createTestUser({
      uid: "friendRoomBadJoin", nickname: "BadJoin",
      initialPokemon: [{ species: "pikachu", level: 50 }],
    });
    let client: PvpClientHandle | null = null;
    try {
      client = await createPvpClient(ctx.baseUrl, B.token);
      const errored = client.waitFor<{ message: string }>("pvp:error", 5000);
      await client.emit("pvp:join_room", { roomId: "nonexistent-room-id" });
      const err = await errored;
      expect(err.message).toMatch(/방/);
    } finally {
      client?.close();
    }
  });

  it("Joining a fully-occupied room → pvp:error", async () => {
    const A = await createTestUser({
      uid: "friendFullA", nickname: "FullA",
      initialPokemon: [{ species: "pikachu", level: 50 }],
    });
    const B = await createTestUser({
      uid: "friendFullB", nickname: "FullB",
      initialPokemon: [{ species: "charmander", level: 50 }],
    });
    const C = await createTestUser({
      uid: "friendFullC", nickname: "FullC",
      initialPokemon: [{ species: "squirtle", level: 50 }],
    });

    let clientA: PvpClientHandle | null = null;
    let clientB: PvpClientHandle | null = null;
    let clientC: PvpClientHandle | null = null;
    try {
      clientA = await createPvpClient(ctx.baseUrl, A.token);
      clientB = await createPvpClient(ctx.baseUrl, B.token);
      clientC = await createPvpClient(ctx.baseUrl, C.token);

      const created = clientA.waitFor<{ roomId: string }>("pvp:room_created", 5000);
      await clientA.emit("pvp:create_room");
      const { roomId } = await created;

      // B fills the room first.
      const stateB = clientB.waitFor("pvp:room_state", 5000);
      await clientB.emit("pvp:join_room", { roomId });
      await stateB;

      // C tries to join the same room → pvp:error.
      const errored = clientC.waitFor<{ message: string }>("pvp:error", 5000);
      await clientC.emit("pvp:join_room", { roomId });
      const err = await errored;
      expect(err.message).toMatch(/방/);
    } finally {
      clientA?.close();
      clientB?.close();
      clientC?.close();
    }
  }, 20_000);
});
