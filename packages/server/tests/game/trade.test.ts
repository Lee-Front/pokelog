import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

type TradeModule = typeof import("../../src/game/trade.js");
type UserStoreModule = typeof import("../../src/storage/user-store.js");
type FactoryModule = typeof import("../../src/game/pokemon-factory.js");

let tmpDir: string;
let tradeModule: TradeModule;
let userStoreModule: UserStoreModule;
let factoryModule: FactoryModule;

function createUser(id: string, nickname: string, pokemon: OwnedPokemon): UserData {
  return {
    account: {
      id,
      password: "pw",
      nickname,
      createdAt: "2026-04-13T00:00:00.000Z",
      matchings: {},
    },
    currentRegion: "default",
    points: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [pokemon.uid],
    pokemon: [pokemon],
    eggs: [],
    pokedex: [pokemon.species],
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

function createStoredUser(
  id: string,
  nickname: string,
  partyPokemon: OwnedPokemon,
  storagePokemon: OwnedPokemon[],
): UserData {
  const user = createUser(id, nickname, partyPokemon);
  user.storage = storagePokemon;
  return user;
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-trade-test-"));
  process.env.POKELOG_DATA_DIR = tmpDir;
  vi.resetModules();

  tradeModule = await import("../../src/game/trade.js");
  userStoreModule = await import("../../src/storage/user-store.js");
  factoryModule = await import("../../src/game/pokemon-factory.js");
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("trade", () => {
  it("creates and lists a pending trade request", async () => {
    const alicePokemon = factoryModule.createPokemon("kadabra", 30);
    const bobPokemon = factoryModule.createPokemon("machoke", 30);
    await userStoreModule.saveUser(createUser("alice", "Alice", alicePokemon));
    await userStoreModule.saveUser(createUser("bob", "Bob", bobPokemon));

    const trade = await tradeModule.createTradeRequest({
      requesterUserId: "alice",
      responderUserId: "bob",
      requesterPokemonUid: alicePokemon.uid,
      responderPokemonUid: bobPokemon.uid,
    });

    const aliceTrades = await tradeModule.listTradesForUser("alice");
    const bobTrades = await tradeModule.listTradesForUser("bob");

    expect(trade.status).toBe("pending");
    expect(aliceTrades).toHaveLength(1);
    expect(bobTrades).toHaveLength(1);
  });

  it("accepts a trade and swaps both Pokemon with trade evolution applied", async () => {
    const alicePokemon = factoryModule.createPokemon("kadabra", 30);
    const bobPokemon = factoryModule.createPokemon("machoke", 30);
    await userStoreModule.saveUser(createUser("alice", "Alice", alicePokemon));
    await userStoreModule.saveUser(createUser("bob", "Bob", bobPokemon));

    const trade = await tradeModule.createTradeRequest({
      requesterUserId: "alice",
      responderUserId: "bob",
      requesterPokemonUid: alicePokemon.uid,
      responderPokemonUid: bobPokemon.uid,
    });

    const result = await tradeModule.acceptTradeRequest("bob", trade.id);
    const alice = await userStoreModule.getUser("alice");
    const bob = await userStoreModule.getUser("bob");

    expect(result.trade.status).toBe("accepted");
    expect(result.requesterEvolution.toSpecies).toBe("machamp");
    expect(result.responderEvolution.toSpecies).toBe("alakazam");
    expect(alice?.pokemon[0]?.species).toBe("machamp");
    expect(bob?.pokemon[0]?.species).toBe("alakazam");
  });

  it("supports trade_species partner requirements", async () => {
    const alicePokemon = factoryModule.createPokemon("karrablast", 30);
    const bobPokemon = factoryModule.createPokemon("shelmet", 30);
    await userStoreModule.saveUser(createUser("alice", "Alice", alicePokemon));
    await userStoreModule.saveUser(createUser("bob", "Bob", bobPokemon));

    const trade = await tradeModule.createTradeRequest({
      requesterUserId: "alice",
      responderUserId: "bob",
      requesterPokemonUid: alicePokemon.uid,
      responderPokemonUid: bobPokemon.uid,
    });

    const result = await tradeModule.acceptTradeRequest("bob", trade.id);
    const alice = await userStoreModule.getUser("alice");
    const bob = await userStoreModule.getUser("bob");

    expect(result.requesterEvolution.toSpecies).toBe("accelgor");
    expect(result.responderEvolution.toSpecies).toBe("escavalier");
    expect(alice?.pokemon[0]?.species).toBe("accelgor");
    expect(bob?.pokemon[0]?.species).toBe("escavalier");
  });

  it("lists trade candidates for both users and excludes battling Pokemon", async () => {
    const aliceParty = factoryModule.createPokemon("pikachu", 20);
    const aliceStorage = factoryModule.createPokemon("eevee", 18);
    const bobParty = factoryModule.createPokemon("gastly", 16);
    const bobStorage = factoryModule.createPokemon("abra", 12);

    const alice = createStoredUser("alice", "Alice", aliceParty, [aliceStorage]);
    alice.battleState = {
      eventId: "enc-1",
      myPokemonUid: aliceParty.uid,
      turn: 1,
      wild: {
        species: "pidgey",
        level: 3,
        hp: 10,
        maxHp: 10,
        stats: { attack: 5, defense: 5, speed: 5, spAttack: 5, spDefense: 5 },
        moves: [],
      },
    };

    await userStoreModule.saveUser(alice);
    await userStoreModule.saveUser(createStoredUser("bob", "Bob", bobParty, [bobStorage]));

    const candidates = await tradeModule.listTradeCandidates("alice", "bob");

    expect(candidates.requester.userId).toBe("alice");
    expect(candidates.responder.userId).toBe("bob");
    expect(candidates.requester.pokemon).toHaveLength(1);
    expect(candidates.requester.pokemon[0]).toMatchObject({
      uid: aliceStorage.uid,
      species: "eevee",
      location: "storage",
    });
    expect(candidates.responder.pokemon).toHaveLength(2);
    expect(candidates.responder.pokemon.map((entry) => entry.uid)).toEqual([bobParty.uid, bobStorage.uid]);
  });

  it("blocks locked Pokemon from trade creation and candidate lists", async () => {
    const alicePokemon = factoryModule.createPokemon("pikachu", 20);
    const bobPokemon = factoryModule.createPokemon("eevee", 20);
    alicePokemon.tradeLocked = true;

    await userStoreModule.saveUser(createUser("alice", "Alice", alicePokemon));
    await userStoreModule.saveUser(createUser("bob", "Bob", bobPokemon));

    const candidates = await tradeModule.listTradeCandidates("alice", "bob");
    expect(candidates.requester.pokemon).toHaveLength(0);

    await expect(tradeModule.createTradeRequest({
      requesterUserId: "alice",
      responderUserId: "bob",
      requesterPokemonUid: alicePokemon.uid,
      responderPokemonUid: bobPokemon.uid,
    })).rejects.toThrow("trade-locked");
  });
});
