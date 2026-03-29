import { describe, expect, it } from "vitest";
import { DEFAULT_INTEGRATION_REWARD_RULES, INTEGRATION_EVENT_CATALOG, mergeIntegrationRewardRules } from "./event-catalog.js";

describe("integration event catalog", () => {
  it("merges partial admin rules without dropping defaults", () => {
    const merged = mergeIntegrationRewardRules({
      notion: {
        page_created: {
          enabled: false,
          points: 99,
        },
      },
    });

    expect(merged.notion.page_created.enabled).toBe(false);
    expect(merged.notion.page_created.points).toBe(99);
    expect(merged.notion.status_done).toEqual(DEFAULT_INTEGRATION_REWARD_RULES.notion.status_done);
    expect(merged.jira.issue_done).toEqual(DEFAULT_INTEGRATION_REWARD_RULES.jira.issue_done);
  });

  it("keeps a rule entry for every catalog event", () => {
    for (const event of INTEGRATION_EVENT_CATALOG.notion) {
      expect(DEFAULT_INTEGRATION_REWARD_RULES.notion[event.key]).toBeDefined();
    }
    for (const event of INTEGRATION_EVENT_CATALOG.jira) {
      expect(DEFAULT_INTEGRATION_REWARD_RULES.jira[event.key]).toBeDefined();
    }
    for (const event of INTEGRATION_EVENT_CATALOG.slack) {
      expect(DEFAULT_INTEGRATION_REWARD_RULES.slack[event.key]).toBeDefined();
    }
  });
});
