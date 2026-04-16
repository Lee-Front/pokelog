import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/storage/json-store.js", () => ({
  readJson: vi.fn().mockResolvedValue(null),
  writeJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/storage/user-store.js", () => ({
  getUser: vi.fn(),
  saveUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/paths.js", () => ({
  getDataDir: () => "/tmp/test-data",
}));

import { recordMatch, getMatchHistory } from "../../src/pvp/pvp-store.js";
import { readJson, writeJson } from "../../src/storage/json-store.js";
import { getUser, saveUser } from "../../src/storage/user-store.js";

function makeUser(userId: string, nickname: string, rating = 1000) {
  return {
    id: userId,
    account: { nickname, passwordHash: "", createdAt: "" },
    pokemon: [],
    party: [],
    storage: [],
    pokedex: [],
    bag: {},
    totalExp: 0,
    points: 500,
    region: "grassland",
    pvpStats: { rating, wins: 0, losses: 0, streak: 0 },
  };
}

describe("pvp-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("recordMatch", () => {
    it("returns null if winner or loser is null", async () => {
      const result = await recordMatch(null, "loser", "ko");
      expect(result).toBeNull();
    });

    it("returns null if user not found", async () => {
      (getUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await recordMatch("w", "l", "ko");
      expect(result).toBeNull();
    });

    it("updates ratings and saves both users", async () => {
      const winner = makeUser("w1", "Winner");
      const loser = makeUser("l1", "Loser");
      (getUser as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(winner)
        .mockResolvedValueOnce(loser);
      (readJson as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await recordMatch("w1", "l1", "ko");

      expect(result).not.toBeNull();
      expect(result!.winnerId).toBe("w1");
      expect(winner.pvpStats!.wins).toBe(1);
      expect(winner.pvpStats!.rating).toBeGreaterThan(1000);
      expect(loser.pvpStats!.losses).toBe(1);
      expect(loser.pvpStats!.rating).toBeLessThan(1000);
      expect(winner.points).toBe(600); // +100
      expect(loser.points).toBe(520);  // +20
      expect(saveUser).toHaveBeenCalledTimes(2);
      expect(writeJson).toHaveBeenCalled();
    });

    it("increments winner streak, resets loser streak", async () => {
      const winner = makeUser("w1", "Winner");
      winner.pvpStats!.streak = 3;
      const loser = makeUser("l1", "Loser");
      loser.pvpStats!.streak = 5;
      (getUser as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(winner)
        .mockResolvedValueOnce(loser);
      (readJson as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await recordMatch("w1", "l1", "ko");
      expect(winner.pvpStats!.streak).toBe(4);
      expect(loser.pvpStats!.streak).toBe(0);
    });
  });

  describe("getMatchHistory", () => {
    it("returns empty array when no history", async () => {
      (readJson as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await getMatchHistory();
      expect(result).toEqual([]);
    });

    it("returns last N records", async () => {
      const records = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` }));
      (readJson as ReturnType<typeof vi.fn>).mockResolvedValue(records);
      const result = await getMatchHistory(3);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: "r7" });
    });
  });
});
