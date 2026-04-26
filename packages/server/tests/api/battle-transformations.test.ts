import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "./test-helpers.js";

describe("battle-transformations API", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  function findMoveId(
    pokemon: { moves: Array<{ id: string }> },
    preferredMoveId: string,
  ): string {
    return pokemon.moves.find((move) => move.id === preferredMoveId)?.id ?? pokemon.moves[0].id;
  }

  it("primal reversion activates automatically on battle start for groudon + red-orb", async () => {
    const { token, userId } = await t.registerAndLogin("primal1", "charmander");
    const api = t.authed(token);

    // Give user a groudon
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "groudon",
      level: 50,
    });
    expect(give.status).toBe(200);
    const groudonUid = give.body.pokemon.uid;

    // Give red-orb and equip
    await t.admin().post("/api/admin/test/give-item", { userId, item: "red-orb", quantity: 1 });
    const equip = await api.post("/api/game/items/equip", {
      item: "red-orb",
      pokemonUid: groudonUid,
    });
    expect(equip.status).toBe(200);
    expect(equip.body.pokemon.heldItem).toBe("red-orb");

    // Create encounter
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 5,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Start battle with groudon
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: groudonUid,
    });
    expect(start.status).toBe(200);
    expect(start.body.battleState.playerBattleForm).toBe("groudon-primal");
    expect(start.body.battleState.transformationType).toBe("primal");

    // Run away to end battle cleanly
    const run = await api.post("/api/battle/action", { action: "run" });
    expect(run.status).toBe(200);
    expect(run.body.battleState).toBeNull();
  });

  it("mega evolution activates on fight with mega:true", async () => {
    const { token, userId } = await t.registerAndLogin("mega1", "charmander");
    const api = t.authed(token);

    // Give user a charizard
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "charizard",
      level: 50,
    });
    expect(give.status).toBe(200);
    const charizardUid = give.body.pokemon.uid;

    // Give charizardite-x and key-stone
    await t.admin().post("/api/admin/test/give-item", { userId, item: "charizardite-x", quantity: 1 });
    await t.admin().post("/api/admin/test/give-item", { userId, item: "key-stone", quantity: 1 });

    // Equip charizardite-x
    const equip = await api.post("/api/game/items/equip", {
      item: "charizardite-x",
      pokemonUid: charizardUid,
    });
    expect(equip.status).toBe(200);

    // Create encounter
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 5,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Start battle
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: charizardUid,
    });
    expect(start.status).toBe(200);
    // No transformation at start
    expect(start.body.battleState.transformationType).toBeUndefined();

    // Get charizard's first move
    const party = await api.get("/api/game/party");
    const charizard = party.body.party.find((p: { uid: string }) => p.uid === charizardUid);
    const moveId = charizard.moves[0].id;

    // Fight with mega:true
    const fight = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId, mega: true },
    });
    expect(fight.status).toBe(200);
    // Verify mega form applied
    if (fight.body.battleState) {
      expect(fight.body.battleState.playerBattleForm).toBe("charizard-mega-x");
      expect(fight.body.battleState.transformationType).toBe("mega");
      expect(fight.body.battleState.transformationUsed).toBe(true);
    }
    // Log should mention mega evolution
    expect(fight.body.log.some((l: string) => l.includes("메가진화"))).toBe(true);
  });

  it("reverts mega stats after the battle ends", async () => {
    const { token, userId } = await t.registerAndLogin("megaend", "charmander");
    const api = t.authed(token);

    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "charizard",
      level: 80,
    });
    expect(give.status).toBe(200);
    const charizardUid = (give.body as { pokemon: { uid: string } }).pokemon.uid;

    await t.admin().post("/api/admin/test/give-item", { userId, item: "charizardite-x", quantity: 1 });
    await t.admin().post("/api/admin/test/give-item", { userId, item: "key-stone", quantity: 1 });

    const equip = await api.post("/api/game/items/equip", {
      item: "charizardite-x",
      pokemonUid: charizardUid,
    });
    expect(equip.status).toBe(200);

    const beforeParty = await api.get("/api/game/party");
    const beforeCharizard = (beforeParty.body as { party: Array<{ uid: string; stats: { attack: number } }> }).party
      .find((pokemon) => pokemon.uid === charizardUid)!;
    const baseAttack = beforeCharizard.stats.attack;

    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "magikarp",
      level: 5,
    });
    expect(enc.status).toBe(200);
    const eventId = (enc.body as { event: { id: string } }).event.id;

    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: charizardUid,
    });
    expect(start.status).toBe(200);

    const battleParty = await api.get("/api/game/party");
    const battleCharizard = (battleParty.body as { party: Array<{ uid: string; moves: Array<{ id: string }> }> }).party
      .find((pokemon) => pokemon.uid === charizardUid)!;
    const moveId = findMoveId(battleCharizard, "scary-face");

    const fight = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId, mega: true },
    });
    expect(fight.status).toBe(200);
    expect((fight.body as { battleState?: { playerBattleForm?: string } }).battleState?.playerBattleForm).toBe("charizard-mega-y");

    const duringParty = await api.get("/api/game/party");
    const transformedCharizard = (duringParty.body as { party: Array<{ uid: string; stats: { attack: number } }> }).party
      .find((pokemon) => pokemon.uid === charizardUid)!;
    expect(transformedCharizard.stats.attack).toBeGreaterThan(baseAttack);

    const run = await api.post("/api/battle/action", { action: "run" });
    expect(run.status).toBe(200);
    expect((run.body as { battleState: null }).battleState).toBeNull();

    const afterParty = await api.get("/api/game/party");
    const revertedCharizard = (afterParty.body as { party: Array<{ uid: string; stats: { attack: number } }> }).party
      .find((pokemon) => pokemon.uid === charizardUid)!;
    expect(revertedCharizard.stats.attack).toBe(baseAttack);
  });

  it("rejects mega evolution twice in same battle", async () => {
    const { token, userId } = await t.registerAndLogin("mega2", "charmander");
    const api = t.authed(token);

    // Give user a charizard
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "charizard",
      level: 80,
    });
    expect(give.status).toBe(200);
    const charizardUid = give.body.pokemon.uid;

    // Give items
    await t.admin().post("/api/admin/test/give-item", { userId, item: "charizardite-x", quantity: 1 });
    await t.admin().post("/api/admin/test/give-item", { userId, item: "key-stone", quantity: 1 });

    // Equip
    const equip = await api.post("/api/game/items/equip", {
      item: "charizardite-x",
      pokemonUid: charizardUid,
    });
    expect(equip.status).toBe(200);

    // Create encounter (weak pokemon)
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 5,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Start battle
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: charizardUid,
    });
    expect(start.status).toBe(200);

    const party = await api.get("/api/game/party");
    const charizard = party.body.party.find((p: { uid: string }) => p.uid === charizardUid);
    const moveId = charizard.moves[0].id;

    // First mega - should succeed
    const fight1 = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId, mega: true },
    });
    expect(fight1.status).toBe(200);

    // If battle is still going, try mega again - should fail
    if (fight1.body.battleState) {
      const fight2 = await api.post("/api/battle/action", {
        action: "fight",
        data: { moveId, mega: true },
      });
      expect(fight2.status).toBe(400);
      expect(fight2.body.error).toBeTruthy();
    }
  });

  it("gigantamax activates and reverts after 3 turns", async () => {
    const { token, userId } = await t.registerAndLogin("gmax1", "charmander");
    const api = t.authed(token);

    // Give user a charizard with gmax factor
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "charizard",
      level: 80,
      hasGigantamaxFactor: true,
    });
    expect(give.status).toBe(200);
    const charizardUid = (give.body as { pokemon: { uid: string } }).pokemon.uid;

    await t.admin().post("/api/admin/test/give-item", { userId, item: "dynamax-band", quantity: 1 });

    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "magikarp",
      level: 5,
    });
    expect(enc.status).toBe(200);
    const eventId = (enc.body as { event: { id: string } }).event.id;

    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: charizardUid,
    });
    expect(start.status).toBe(200);

    const party = await api.get("/api/game/party");
    const charizard = (party.body as { party: Array<{ uid: string; maxHp: number; moves: Array<{ id: string }> }> }).party
      .find((p) => p.uid === charizardUid)!;
    const baseMaxHp = charizard.maxHp;
    const moveId = findMoveId(charizard, "scary-face");

    const fight1 = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId, gigantamax: true },
    });
    expect(fight1.status).toBe(200);
    expect((fight1.body as { battleState?: { playerBattleForm?: string | null; transformationType?: string | null; gmaxTurnsRemaining?: number } }).battleState?.playerBattleForm).toBe("charizard-gmax");
    expect((fight1.body as { battleState?: { transformationType?: string | null } }).battleState?.transformationType).toBe("gigantamax");
    expect((fight1.body as { battleState?: { gmaxTurnsRemaining?: number } }).battleState?.gmaxTurnsRemaining).toBe(2);

    const duringParty = await api.get("/api/game/party");
    const gmaxCharizard = (duringParty.body as { party: Array<{ uid: string; maxHp: number }> }).party
      .find((pokemon) => pokemon.uid === charizardUid)!;
    expect(gmaxCharizard.maxHp).toBeGreaterThan(baseMaxHp);

    const fight2 = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId },
    });
    expect(fight2.status).toBe(200);
    expect((fight2.body as { battleState?: { playerBattleForm?: string | null; gmaxTurnsRemaining?: number } }).battleState?.playerBattleForm).toBe("charizard-gmax");
    expect((fight2.body as { battleState?: { gmaxTurnsRemaining?: number } }).battleState?.gmaxTurnsRemaining).toBe(1);

    const fight3 = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId },
    });
    expect(fight3.status).toBe(200);
    expect((fight3.body as { result: string }).result).toBe("continue");
    expect((fight3.body as { battleState?: { playerBattleForm?: string | null; transformationType?: string | null } }).battleState?.playerBattleForm).toBeNull();
    expect((fight3.body as { battleState?: { transformationType?: string | null } }).battleState?.transformationType).toBeNull();

    const afterParty = await api.get("/api/game/party");
    const revertedCharizard = (afterParty.body as { party: Array<{ uid: string; maxHp: number; hp: number }> }).party
      .find((pokemon) => pokemon.uid === charizardUid)!;
    expect(revertedCharizard.maxHp).toBe(baseMaxHp);
    expect(revertedCharizard.hp).toBeLessThanOrEqual(baseMaxHp);
  });

  it("mega evolves without a key-stone (item gating removed)", async () => {
    const { token, userId } = await t.registerAndLogin("mega3", "charmander");
    const api = t.authed(token);

    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "charizard",
      level: 50,
    });
    expect(give.status).toBe(200);
    const charizardUid = give.body.pokemon.uid;

    // No key-stone, no mega-stone heldItem — mega evolution still works
    // because gating is purely species-based now.
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 5,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: charizardUid,
    });
    expect(start.status).toBe(200);

    const party = await api.get("/api/game/party");
    const charizard = party.body.party.find((p: { uid: string }) => p.uid === charizardUid);
    const moveId = charizard.moves[0].id;

    const fight = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId, mega: true },
    });
    expect(fight.status).toBe(200);
    const log = (fight.body as { log: string[] }).log;
    expect(log.some((line) => line.includes("메가진화했다"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Battle error cases
  // -------------------------------------------------------------------------

  it("rejects fight action without moveId → 400", async () => {
    const { token, userId } = await t.registerAndLogin("berr1", "charmander");
    const api = t.authed(token);

    // Create encounter and start battle
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 5,
    });
    expect(enc.status).toBe(200);

    const party = await api.get("/api/game/party");
    const pokemonUid = party.body.party[0].uid;

    const start = await api.post("/api/battle/start", {
      eventId: enc.body.event.id,
      pokemonUid,
    });
    expect(start.status).toBe(200);

    // Fight without moveId
    const fight = await api.post("/api/battle/action", {
      action: "fight",
      data: {},
    });
    expect(fight.status).toBe(400);
  });

  it("rejects invalid action string → 400", async () => {
    const { token, userId } = await t.registerAndLogin("berr2", "charmander");
    const api = t.authed(token);

    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 5,
    });
    expect(enc.status).toBe(200);

    const party = await api.get("/api/game/party");
    const pokemonUid = party.body.party[0].uid;

    await api.post("/api/battle/start", {
      eventId: enc.body.event.id,
      pokemonUid,
    });

    const res = await api.post("/api/battle/action", {
      action: "dance",
    });
    expect(res.status).toBe(400);
  });

  it("rejects fight when no active battle → 400", async () => {
    const { token } = await t.registerAndLogin("berr3", "charmander");
    const api = t.authed(token);

    // No battle started — attempt action
    const res = await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId: "tackle" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects switch to non-party pokemon UID → 400 or 404", async () => {
    const { token, userId } = await t.registerAndLogin("berr4", "charmander");
    const api = t.authed(token);

    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 5,
    });
    expect(enc.status).toBe(200);

    const party = await api.get("/api/game/party");
    const pokemonUid = party.body.party[0].uid;

    await api.post("/api/battle/start", {
      eventId: enc.body.event.id,
      pokemonUid,
    });

    const res = await api.post("/api/battle/action", {
      action: "switch",
      data: { pokemonUid: "non-existent-uid" },
    });
    // Server returns 404 for pokemon not found
    expect([400, 404]).toContain(res.status);
  });
});
