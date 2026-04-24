import type { Server, Socket } from "socket.io";
import { verifyToken } from "../auth/auth.js";
import { getUser } from "../storage/user-store.js";
import { enqueue, dequeueBySocketId, tryMatch } from "./matchmaking.js";
import {
  createRoom, selectLead, submitAction, getPlayerView,
  getRoom, deleteRoom, getPlayerSide, DEFAULT_CONFIG,
} from "./pvp-room.js";
import { chooseAiAction } from "./pvp-ai.js";
import { recordMatch } from "./pvp-store.js";
import { userPartyToPvp as buildUserPvpParty, deepCopyPvpPokemon } from "./pvp-party-builder.js";
import type { PvpAction, PvpRoomState } from "../../../../shared/pvp-types.js";

// socketId → { userId, roomId }
const socketState = new Map<string, { userId: string; roomId?: string }>();

// roomId → active turn timeout handle
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();

function startTurnTimer(io: Server, room: PvpRoomState): void {
  clearTurnTimer(room.roomId);
  const timer = setTimeout(async () => {
    turnTimers.delete(room.roomId);
    const currentRoom = getRoom(room.roomId);
    if (!currentRoom || currentRoom.phase === "finished") return;

    // Auto-submit for players who haven't acted
    for (const player of [currentRoom.playerA, currentRoom.playerB]) {
      if (!player.actionSubmitted) {
        const poke = player.party[player.activeIndex];
        let action: PvpAction;
        if (currentRoom.phase === "forced_switch") {
          const aliveIdx = player.party.findIndex((p, i) => p.hp > 0 && i !== player.activeIndex);
          action = aliveIdx >= 0 ? { type: "switch", pokemonIndex: aliveIdx } : { type: "forfeit" };
        } else {
          const usable = poke.moves.find((m) => m.pp > 0);
          action = usable ? { type: "fight", moveId: usable.id } : { type: "fight", moveId: poke.moves[0]?.id ?? "tackle" };
        }
        submitAction(currentRoom, player.userId, action);
      }
    }

    // Re-read room after submitting actions (phase may now be "finished")
    const freshRoom = getRoom(room.roomId);
    const afterRoom: PvpRoomState = freshRoom ?? currentRoom;

    // Broadcast result
    if (afterRoom.phase === "finished" && afterRoom.result) {
      await recordMatch(afterRoom.result.winnerId, afterRoom.result.loserId, afterRoom.result.reason);
      emitTurnResult(io, afterRoom);
      // Invariant: always clearTurnTimer BEFORE deleteRoom so the map
      // never carries a handle whose room no longer exists. (The timer
      // that invoked us has already self-cleaned at the top of the
      // callback, but we repeat it for safety in case the room state
      // changed to finished via another path while we were awaiting.)
      clearTurnTimer(afterRoom.roomId);
      deleteRoom(afterRoom.roomId);
    } else {
      emitTurnResult(io, afterRoom);
      if (afterRoom.phase === "action" || afterRoom.phase === "forced_switch") {
        startTurnTimer(io, afterRoom);
      }
    }
  }, DEFAULT_CONFIG.turnTimeoutMs);
  turnTimers.set(room.roomId, timer);
}

export function clearTurnTimer(roomId: string): void {
  const existing = turnTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    turnTimers.delete(roomId);
  }
}

const userPartyToPvp = buildUserPvpParty;

export function setupPvpSocket(io: Server): void {
  io.on("connection", (socket: Socket) => {
    // ── Auth ──
    socket.on("pvp:auth", async (data: { token: string }) => {
      const payload = verifyToken(data.token);
      if (!payload) { socket.emit("pvp:error", { message: "인증 실패" }); return; }
      socketState.set(socket.id, { userId: payload.userId });
      socket.emit("pvp:authenticated");
    });

    // ── Random matchmaking ──
    socket.on("pvp:queue", async () => {
      const state = socketState.get(socket.id);
      if (!state) { socket.emit("pvp:error", { message: "인증이 필요합니다" }); return; }
      const user = await getUser(state.userId);
      if (!user) { socket.emit("pvp:error", { message: "유저를 찾을 수 없습니다" }); return; }

      enqueue({ userId: state.userId, socketId: socket.id, nickname: user.account.nickname });
      socket.emit("pvp:queued", { position: 0 });

      const pair = tryMatch();
      if (pair) {
        const [a, b] = pair;
        const userA = await getUser(a.userId);
        const userB = await getUser(b.userId);
        if (!userA || !userB) return;

        const pvpA = userPartyToPvp(userA);
        const pvpB = userPartyToPvp(userB);
        const room = createRoom(
          a.userId, a.nickname, pvpA.party,
          b.userId, b.nickname, pvpB.party,
          false,
          { hasKeyStone: pvpA.hasKeyStone, hasDynamaxBand: pvpA.hasDynamaxBand },
          { hasKeyStone: pvpB.hasKeyStone, hasDynamaxBand: pvpB.hasDynamaxBand },
        );

        const sockA = io.sockets.sockets.get(a.socketId);
        const sockB = io.sockets.sockets.get(b.socketId);
        sockA?.join(room.roomId);
        sockB?.join(room.roomId);

        const stA = socketState.get(a.socketId);
        const stB = socketState.get(b.socketId);
        if (stA) stA.roomId = room.roomId;
        if (stB) stB.roomId = room.roomId;

        sockA?.emit("pvp:matched", { roomId: room.roomId, opponent: b.nickname });
        sockB?.emit("pvp:matched", { roomId: room.roomId, opponent: a.nickname });
        sockA?.emit("pvp:room_state", getPlayerView(room, a.userId));
        sockB?.emit("pvp:room_state", getPlayerView(room, b.userId));
      }
    });

    socket.on("pvp:queue_cancel", () => {
      dequeueBySocketId(socket.id);
    });

    // ── Room creation (friend invite) ──
    socket.on("pvp:create_room", async () => {
      const state = socketState.get(socket.id);
      if (!state) return;
      const user = await getUser(state.userId);
      if (!user) return;

      const pvpData = userPartyToPvp(user);
      const room = createRoom(
        state.userId, user.account.nickname, pvpData.party,
        "__waiting__", "대기 중...", [],
        false,
        { hasKeyStone: pvpData.hasKeyStone, hasDynamaxBand: pvpData.hasDynamaxBand },
      );
      state.roomId = room.roomId;
      socket.join(room.roomId);
      socket.emit("pvp:room_created", { roomId: room.roomId });
    });

    // ── Room join ──
    socket.on("pvp:join_room", async (data: { roomId: string }) => {
      const state = socketState.get(socket.id);
      if (!state) return;
      const user = await getUser(state.userId);
      if (!user) return;

      const room = getRoom(data.roomId);
      if (!room || room.playerB.userId !== "__waiting__") {
        socket.emit("pvp:error", { message: "방을 찾을 수 없습니다" });
        return;
      }

      const pvpB = userPartyToPvp(user);
      room.playerB.userId = state.userId;
      room.playerB.nickname = user.account.nickname;
      room.playerB.party = pvpB.party;
      room.playerB.hasKeyStone = pvpB.hasKeyStone;
      room.playerB.hasDynamaxBand = pvpB.hasDynamaxBand;
      state.roomId = room.roomId;
      socket.join(room.roomId);

      // Send individual views to each player
      for (const sid of io.sockets.adapter.rooms.get(room.roomId) ?? []) {
        const s = socketState.get(sid);
        if (s) io.to(sid).emit("pvp:room_state", getPlayerView(room, s.userId));
      }
    });

    // ── AI battle ──
    socket.on("pvp:ai_battle", async () => {
      const state = socketState.get(socket.id);
      if (!state) return;
      const user = await getUser(state.userId);
      if (!user) return;

      const pvpData = userPartyToPvp(user);
      // AI party = deep copy of user party (mirror match)
      const aiParty = pvpData.party.map((p) => ({ ...deepCopyPvpPokemon(p), uid: "ai-" + p.uid }));

      const room = createRoom(
        state.userId, user.account.nickname, pvpData.party,
        "__ai__", "AI 트레이너", aiParty, true,
        { hasKeyStone: pvpData.hasKeyStone, hasDynamaxBand: pvpData.hasDynamaxBand },
        { hasKeyStone: pvpData.hasKeyStone, hasDynamaxBand: pvpData.hasDynamaxBand },
      );
      state.roomId = room.roomId;
      socket.join(room.roomId);
      socket.emit("pvp:matched", { roomId: room.roomId, opponent: "AI 트레이너" });
      socket.emit("pvp:room_state", getPlayerView(room, state.userId));

      // AI auto-selects lead
      selectLead(room, "__ai__", 0);
    });

    // ── Lead selection ──
    socket.on("pvp:select_lead", (data: { pokemonIndex: number }) => {
      const state = socketState.get(socket.id);
      if (!state?.roomId) return;
      const room = getRoom(state.roomId);
      if (!room) return;

      selectLead(room, state.userId, data.pokemonIndex);

      if (room.phase === "action") {
        emitRoomState(io, room);
        startTurnTimer(io, room);
      }
    });

    // ── Action submission ──
    socket.on("pvp:action", async (data: { action: PvpAction }) => {
      const state = socketState.get(socket.id);
      if (!state?.roomId) return;
      const room = getRoom(state.roomId);
      if (!room) return;

      const resolved = submitAction(room, state.userId, data.action);

      // AI auto-submits action
      if (room.isAiBattle && !resolved && room.phase === "action") {
        const aiAction = chooseAiAction(room.playerB, room.playerA);
        submitAction(room, "__ai__", aiAction);
      }

      if (room.phase === "finished" && room.result) {
        clearTurnTimer(room.roomId);
        await recordMatch(room.result.winnerId, room.result.loserId, room.result.reason);
        emitTurnResult(io, room);
        deleteRoom(room.roomId);
      } else {
        emitTurnResult(io, room);
        if (room.phase === "action" || room.phase === "forced_switch") {
          startTurnTimer(io, room);
        }
        // AI auto-switches on forced_switch
        if (room.isAiBattle && room.phase === "forced_switch") {
          const aiAlive = room.playerB.party.findIndex((p, i) => p.hp > 0 && i !== room.playerB.activeIndex);
          if (aiAlive >= 0) {
            submitAction(room, "__ai__", { type: "switch", pokemonIndex: aiAlive });
          }
        }
      }
    });

    // ── Disconnect ──
    socket.on("disconnect", async () => {
      const state = socketState.get(socket.id);
      if (state) {
        dequeueBySocketId(socket.id);
        if (state.roomId) {
          const room = getRoom(state.roomId);
          if (room && room.phase !== "finished") {
            const opp = room.playerA.userId === state.userId ? room.playerB : room.playerA;
            room.phase = "finished";
            room.result = { winnerId: opp.userId, loserId: state.userId, reason: "disconnect" };
            if (!room.isAiBattle) {
              await recordMatch(opp.userId, state.userId, "disconnect");
            }
            io.to(room.roomId).emit("pvp:opponent_disconnected");
            clearTurnTimer(state.roomId);
            deleteRoom(room.roomId);
          }
        }
      }
      socketState.delete(socket.id);
    });
  });
}

function emitRoomState(io: Server, room: PvpRoomState): void {
  for (const sid of io.sockets.adapter.rooms.get(room.roomId) ?? []) {
    const st = socketState.get(sid);
    if (st) {
      io.to(sid).emit("pvp:room_state", getPlayerView(room, st.userId));
    }
  }
}

function emitTurnResult(io: Server, room: PvpRoomState): void {
  for (const sid of io.sockets.adapter.rooms.get(room.roomId) ?? []) {
    const st = socketState.get(sid);
    if (st) {
      io.to(sid).emit("pvp:turn_result", {
        log: room.log,
        state: getPlayerView(room, st.userId),
      });
    }
  }
}
