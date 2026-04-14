import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("trade flow", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t.cleanup();
  });

  it("lists empty trades for new user", async () => {
    const { token } = await t.registerAndLogin();
    const api = t.authed(token);

    const res = await api.get("/api/game/trades");
    expect(res.status).toBe(200);
    expect(res.body.trades).toHaveLength(0);
  });

  it("creates a trade request between two users", async () => {
    const user1 = await t.registerAndLogin("trader1", "charmander");
    const user2 = await t.registerAndLogin("trader2", "squirtle");
    const api1 = t.authed(user1.token);
    const api2 = t.authed(user2.token);

    // 양쪽 파티 확인
    const party1 = await api1.get("/api/game/party");
    const party2 = await api2.get("/api/game/party");
    const poke1 = party1.body.party[0];
    const poke2 = party2.body.party[0];

    // 교환 요청
    const req = await api1.post("/api/game/trades/request", {
      targetUserId: user2.userId,
      myPokemonUid: poke1.uid,
      targetPokemonUid: poke2.uid,
    });
    expect(req.status).toBe(201);
    expect(req.body.trade).toBeDefined();
    expect(req.body.trade.status).toBe("pending");

    const tradeId = req.body.trade.id;

    // user2가 교환 목록에서 확인
    const trades2 = await api2.get("/api/game/trades");
    expect(trades2.body.trades.length).toBe(1);

    // user2가 수락
    const accept = await api2.post(`/api/game/trades/${tradeId}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.trade.status).toBe("accepted");

    // 교환 후 포켓몬 확인 — user1은 squirtle, user2는 charmander
    const newParty1 = await api1.get("/api/game/party");
    const newParty2 = await api2.get("/api/game/party");
    expect(newParty1.body.party[0].species).toBe("squirtle");
    expect(newParty2.body.party[0].species).toBe("charmander");
  });

  it("rejects a trade request", async () => {
    const user1 = await t.registerAndLogin("rejecter1", "charmander");
    const user2 = await t.registerAndLogin("rejecter2", "squirtle");
    const api1 = t.authed(user1.token);
    const api2 = t.authed(user2.token);

    const party1 = await api1.get("/api/game/party");
    const party2 = await api2.get("/api/game/party");

    const req = await api1.post("/api/game/trades/request", {
      targetUserId: user2.userId,
      myPokemonUid: party1.body.party[0].uid,
      targetPokemonUid: party2.body.party[0].uid,
    });
    expect(req.status).toBe(201);
    const tradeId = req.body.trade.id;

    const reject = await api2.post(`/api/game/trades/${tradeId}/reject`);
    expect(reject.status).toBe(200);
    expect(reject.body.trade.status).toBe("rejected");
  });

  it("cancels a trade request", async () => {
    const user1 = await t.registerAndLogin("canceler1", "charmander");
    const user2 = await t.registerAndLogin("canceler2", "squirtle");
    const api1 = t.authed(user1.token);
    const api2 = t.authed(user2.token);

    const party1 = await api1.get("/api/game/party");
    const party2 = await api2.get("/api/game/party");

    const req = await api1.post("/api/game/trades/request", {
      targetUserId: user2.userId,
      myPokemonUid: party1.body.party[0].uid,
      targetPokemonUid: party2.body.party[0].uid,
    });
    expect(req.status).toBe(201);
    const tradeId = req.body.trade.id;

    const cancel = await api1.post(`/api/game/trades/${tradeId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.trade.status).toBe("cancelled");
  });

  it("returns error for trade with nonexistent target user", async () => {
    const user1 = await t.registerAndLogin("traderalone", "charmander");
    const api1 = t.authed(user1.token);

    const party1 = await api1.get("/api/game/party");

    const req = await api1.post("/api/game/trades/request", {
      targetUserId: "nonexistentuser",
      myPokemonUid: party1.body.party[0].uid,
      targetPokemonUid: "fake-uid",
    });
    expect(req.status).toBe(400);
    expect(req.body.error).toBeDefined();
  });

  it("locks pokemon from trading", async () => {
    const { token } = await t.registerAndLogin("lockuser", "charmander");
    const api = t.authed(token);

    const party = await api.get("/api/game/party");
    const uid = party.body.party[0].uid;

    const lock = await api.post("/api/game/trades/lock", { pokemonUid: uid });
    expect(lock.status).toBe(200);

    // 잠긴 포켓몬 확인
    const detail = await api.get(`/api/game/pokemon/${uid}`);
    expect(detail.body.pokemon.tradeLocked).toBe(true);
  });
});
