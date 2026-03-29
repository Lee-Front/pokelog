import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommitInfo } from "./git-client.js";

// Mock all dependencies before importing the module under test
vi.mock("../storage/user-store.js", () => ({
  getUsersForRepoCommit: vi.fn(),
  saveUser: vi.fn(),
}));

vi.mock("../storage/config-store.js", () => ({
  getConfig: vi.fn(),
}));

vi.mock("./git-client.js", () => ({
  getCommitByteChanges: vi.fn(),
}));

vi.mock("../game/reward.js", () => ({
  calculateReward: vi.fn(),
}));

vi.mock("../game/combo.js", () => ({
  judgeCombo: vi.fn(),
  getComboMultiplier: vi.fn(),
}));

vi.mock("../game/encounter.js", () => ({
  checkEncounter: vi.fn(),
  selectWildPokemon: vi.fn(),
}));

vi.mock("../game/pokemon-factory.js", () => ({
  createWildPokemon: vi.fn(),
}));

import { processCommit } from "./commit-processor.js";
import { getUsersForRepoCommit, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { getCommitByteChanges } from "./git-client.js";
import { calculateReward } from "../game/reward.js";
import { judgeCombo, getComboMultiplier } from "../game/combo.js";
import { checkEncounter } from "../game/encounter.js";

const mockGetUsersForRepoCommit = vi.mocked(getUsersForRepoCommit);
const mockSaveUser = vi.mocked(saveUser);
const mockGetConfig = vi.mocked(getConfig);
const mockGetBytes = vi.mocked(getCommitByteChanges);
const mockCalcReward = vi.mocked(calculateReward);
const mockJudgeCombo = vi.mocked(judgeCombo);
const mockGetMultiplier = vi.mocked(getComboMultiplier);
const mockCheckEncounter = vi.mocked(checkEncounter);

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: "abc123",
    authorEmail: "dev@example.com",
    timestamp: "2026-01-01T00:00:00Z",
    parentCount: 1,
    message: "test commit",
    ...overrides,
  };
}

function makeUser() {
  return {
    account: {
      id: "user1",
      password: "hashed",
      nickname: "Ash",
      createdAt: "2026-01-01T00:00:00Z",
      matchings: { git: { emails: ["dev@example.com"] } },
    },
    points: 100,
    totalExp: 500,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [],
    pokemon: [],
    pokedex: [],
    inventory: {},
    pendingEvents: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

function makeConfig() {
  return {
    server: { port: 3000 },
    polling: { intervalMinutes: 5, repos: [] },
    rewards: {
      expPerByte: 0.5,
      pointsPerByte: 0.1,
      combo: {
        bytesPerMinute: 10,
        multipliers: [1, 1.2, 1.5, 2.0, 3.0],
        maxMultiplier: 3.0,
      },
      encounter: {
        baseChance: 0.3,
        ceilingBytes: 5000,
        timeLimitHours: 24,
      },
    },
    shop: { items: {} },
  };
}

describe("commit-processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips merge commits (parentCount >= 2)", async () => {
    const commit = makeCommit({ parentCount: 2 });
    await processCommit(commit, "/fake/repo", "https://example.com/repo.git");
    expect(mockGetUsersForRepoCommit).not.toHaveBeenCalled();
  });

  it("skips if no matching user found", async () => {
    const commit = makeCommit();
    mockGetUsersForRepoCommit.mockResolvedValue([]);
    await processCommit(commit, "/fake/repo", "https://example.com/repo.git");
    expect(mockGetConfig).not.toHaveBeenCalled();
  });

  it("skips if bytes are 0", async () => {
    const commit = makeCommit();
    mockGetUsersForRepoCommit.mockResolvedValue([makeUser() as any]);
    mockGetConfig.mockResolvedValue(makeConfig() as any);
    mockGetBytes.mockResolvedValue(0);
    await processCommit(commit, "/fake/repo", "https://example.com/repo.git");
    expect(mockSaveUser).not.toHaveBeenCalled();
  });

  it("processes a valid commit and updates user", async () => {
    const commit = makeCommit();
    const user = makeUser();
    const config = makeConfig();

    mockGetUsersForRepoCommit.mockResolvedValue([user as any]);
    mockGetConfig.mockResolvedValue(config as any);
    mockGetBytes.mockResolvedValue(500);
    mockJudgeCombo.mockReturnValue({
      count: 1,
      lastCommitAt: "2026-01-01T00:00:00Z",
    });
    mockGetMultiplier.mockReturnValue(1.2);
    mockCalcReward.mockReturnValue({ exp: 300, points: 60 });
    mockCheckEncounter.mockReturnValue({
      encountered: false,
      newCeiling: 500,
    });

    await processCommit(commit, "/fake/repo", "https://example.com/repo.git");

    expect(mockSaveUser).toHaveBeenCalledOnce();
    const savedUser = mockSaveUser.mock.calls[0][0] as any;
    expect(savedUser.points).toBe(160); // 100 + 60
    expect(savedUser.totalExp).toBe(800); // 500 + 300
    expect(savedUser.combo.count).toBe(1);
    expect(savedUser.encounterCeiling.accumulatedBytes).toBe(500);
    expect(savedUser.log).toHaveLength(1);
    expect(savedUser.log[0].type).toBe("reward");
    expect(savedUser.log[0].bytes).toBe(500);
  });

  it("distributes EXP to party pokemon", async () => {
    const commit = makeCommit();
    const user = makeUser() as any;
    user.party = ["poke-1", "poke-2"];
    user.pokemon = [
      { uid: "poke-1", exp: 0 },
      { uid: "poke-2", exp: 0 },
    ];

    mockGetUsersForRepoCommit.mockResolvedValue([user as any]);
    mockGetConfig.mockResolvedValue(makeConfig() as any);
    mockGetBytes.mockResolvedValue(100);
    mockJudgeCombo.mockReturnValue({
      count: 1,
      lastCommitAt: "2026-01-01T00:00:00Z",
    });
    mockGetMultiplier.mockReturnValue(1);
    mockCalcReward.mockReturnValue({ exp: 100, points: 10 });
    mockCheckEncounter.mockReturnValue({
      encountered: false,
      newCeiling: 100,
    });

    await processCommit(commit, "/fake/repo", "https://example.com/repo.git");

    const savedUser = mockSaveUser.mock.calls[0][0] as any;
    expect(savedUser.pokemon[0].exp).toBe(50); // 100 / 2
    expect(savedUser.pokemon[1].exp).toBe(50);
  });
});
