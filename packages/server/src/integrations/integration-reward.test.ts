import { describe, expect, it } from "vitest";
import { applyIntegrationReward } from "./integration-reward.js";
import { DEFAULT_INTEGRATION_REWARD_RULES } from "./event-catalog.js";
import type { UserData } from "../../../../shared/types.js";

function makeUser(): UserData {
  return {
    account: {
      id: "tester",
      password: "pw",
      nickname: "tester",
      createdAt: new Date().toISOString(),
      matchings: {},
    },
    points: 0,
    gameMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [],
    pokemon: [],
    eggs: [],
    pokedex: [],
    inventory: {},
    pendingEvents: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
    pendingEvolutions: [],
    currentRegion: "default",
  };
}

describe("applyIntegrationReward", () => {
  it("applies enabled rules and respects cooldown", () => {
    const user = makeUser();
    const timestamp = "2026-03-29T10:00:00.000Z";

    const first = applyIntegrationReward(user, DEFAULT_INTEGRATION_REWARD_RULES, {
      provider: "notion",
      eventKey: "page_content_edited",
      sourceId: "page-1",
      timestamp,
      summary: "Page 1",
    });

    const second = applyIntegrationReward(user, DEFAULT_INTEGRATION_REWARD_RULES, {
      provider: "notion",
      eventKey: "page_content_edited",
      sourceId: "page-1",
      timestamp: "2026-03-29T10:05:00.000Z",
      summary: "Page 1",
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(user.points).toBe(DEFAULT_INTEGRATION_REWARD_RULES.notion.page_content_edited.points);
  });
});
