import { describe, it, expect } from "vitest";
import {
  startTower, updateTowerRecord, failTower, grantReward, getStageReward, TOWER_RUN_TTL_MS,
} from "../../src/game/tower.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

function makePokemon(uid: string, species: string, hp = 100): OwnedPokemon {
  return {
    uid,
    species,
    variantId: null,
    nickname: null,
    level: 50,
    exp: 0,
    hp,
    maxHp: 100,
    stats: { attack: 50, defense: 50, speed: 50, spAttack: 50, spDefense: 50 },
    moves: [
      { id: "tackle", pp: 35, maxPp: 35 },
      { id: "growl", pp: 40, maxPp: 40 },
    ],
    caughtAt: new Date().toISOString(),
    gender: "male",
    friendship: 70,
    heldItem: null,
    abilityId: null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: "hardy",
    isShiny: false,
    statusCondition: null,
  };
}

function makeUser(pokemon: OwnedPokemon[] = []): UserData {
  return {
    account: { id: "u1", password: "x", nickname: "tester", createdAt: new Date().toISOString(), matchings: {} },
    points: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [],
    pokemon,
    eggs: [],
    pokedex: [],
    inventory: {},
    pendingEvents: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

describe("tower session manager", () => {
  describe("startTower", () => {
    it("creates a run with stage 1 and snapshot", () => {
      const user = makeUser([
        makePokemon("a", "pikachu"),
        makePokemon("b", "charizard"),
        makePokemon("c", "blastoise"),
      ]);
      const res = startTower(user, ["a", "b", "c"]);
      expect(res.ok).toBe(true);
      expect(res.run?.stage).toBe(1);
      expect(res.run?.partyUids).toEqual(["a", "b", "c"]);
      expect(res.run?.partySnapshot).toHaveLength(3);
      expect(user.activeTowerRun).toBeDefined();
    });

    it("rejects party with fewer than 3 pokemon", () => {
      const user = makeUser([makePokemon("a", "pikachu")]);
      const res = startTower(user, ["a"]);
      expect(res.ok).toBe(false);
    });

    it("rejects fainted pokemon", () => {
      const user = makeUser([
        makePokemon("a", "pikachu", 0),
        makePokemon("b", "charizard"),
        makePokemon("c", "blastoise"),
      ]);
      const res = startTower(user, ["a", "b", "c"]);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("기절");
    });

    it("rejects duplicate species (Species Clause)", () => {
      const user = makeUser([
        makePokemon("a", "pikachu"),
        makePokemon("b", "pikachu"),
        makePokemon("c", "blastoise"),
      ]);
      const res = startTower(user, ["a", "b", "c"]);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("Species Clause");
    });

    it("rejects missing pokemon uid", () => {
      const user = makeUser([makePokemon("a", "pikachu")]);
      const res = startTower(user, ["a", "missing1", "missing2"]);
      expect(res.ok).toBe(false);
    });

    it("blocks a second start while a run is already active", () => {
      const user = makeUser([
        makePokemon("a", "pikachu"),
        makePokemon("b", "charizard"),
        makePokemon("c", "blastoise"),
      ]);
      const first = startTower(user, ["a", "b", "c"]);
      expect(first.ok).toBe(true);
      const second = startTower(user, ["a", "b", "c"]);
      expect(second.ok).toBe(false);
      expect(second.error).toContain("진행 중");
    });

    it("auto-cleans expired runs past 24h TTL", () => {
      const user = makeUser([
        makePokemon("a", "pikachu"),
        makePokemon("b", "charizard"),
        makePokemon("c", "blastoise"),
      ]);
      user.activeTowerRun = {
        stage: 5,
        partyUids: ["a", "b", "c"],
        partySnapshot: [],
        startedAt: new Date(Date.now() - TOWER_RUN_TTL_MS - 1000).toISOString(),
      };
      const res = startTower(user, ["a", "b", "c"]);
      expect(res.ok).toBe(true);
      expect(res.run?.stage).toBe(1);
    });
  });

  describe("updateTowerRecord", () => {
    it("initializes record on first use", () => {
      const user = makeUser();
      updateTowerRecord(user, 3);
      expect(user.towerRecord).toBeDefined();
      expect(user.towerRecord?.currentStreak).toBe(3);
      expect(user.towerRecord?.bestStreak).toBe(3);
      expect(user.towerRecord?.totalClears).toBe(1);
    });

    it("updates best streak only when surpassed", () => {
      const user = makeUser();
      updateTowerRecord(user, 10);
      updateTowerRecord(user, 5);
      expect(user.towerRecord?.currentStreak).toBe(5);
      expect(user.towerRecord?.bestStreak).toBe(10);
      expect(user.towerRecord?.totalClears).toBe(2);
    });
  });

  describe("failTower", () => {
    it("resets current streak and clears active run", () => {
      const user = makeUser([
        makePokemon("a", "pikachu"),
        makePokemon("b", "charizard"),
        makePokemon("c", "blastoise"),
      ]);
      startTower(user, ["a", "b", "c"]);
      updateTowerRecord(user, 12);
      failTower(user);
      expect(user.activeTowerRun).toBeUndefined();
      expect(user.towerRecord?.currentStreak).toBe(0);
      expect(user.towerRecord?.bestStreak).toBe(12);
    });
  });

  describe("grantReward", () => {
    it("awards stage 1 100 points", () => {
      const user = makeUser();
      const reward = grantReward(user, 1);
      expect(reward.points).toBe(100);
      expect(user.points).toBe(100);
    });

    it("awards stage 5 rare-egg and points", () => {
      const user = makeUser();
      const reward = grantReward(user, 5);
      expect(reward.points).toBe(500);
      expect(user.inventory["rare-egg"]).toBe(1);
    });

    it("falls back to linear scaling for unmapped stages", () => {
      const user = makeUser();
      const reward = grantReward(user, 7);
      expect(reward.points).toBe(350);
    });

    it("getStageReward returns consistent shape", () => {
      const r = getStageReward(100);
      expect(r.points).toBe(100000);
      expect(r.items).toHaveLength(1);
    });

    it("awards BP per stage and accumulates on user", () => {
      const user = makeUser();
      const r1 = grantReward(user, 1);
      expect(r1.bp).toBe(1);
      expect(user.bp).toBe(1);
      const r10 = grantReward(user, 10);
      expect(r10.bp).toBe(10);
      expect(user.bp).toBe(11);
      const r50 = grantReward(user, 50);
      expect(r50.bp).toBe(50);
      expect(user.bp).toBe(61);
    });
  });
});
