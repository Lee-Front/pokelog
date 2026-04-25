import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { ServerConfig } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { DEFAULT_INTEGRATION_REWARD_RULES, mergeIntegrationRewardRules } from "../integrations/event-catalog.js";
import { buildDefaultShopItems } from "../game/shop-catalog.js";

function getConfigPath() {
  return path.join(getDataDir(), "config.json");
}

export const DEFAULT_CONFIG: ServerConfig = {
  server: { port: 3000 },
  meta: {
    serverId: "default",
    serverName: "local",
    displayName: "PokeLog Server",
    apiVersion: "1",
    featureFlags: {
      pvp: true,
      trade: true,
      achievements: false,
      regions: false,
    },
  },
  polling: {
    intervalMinutes: 5,
    repos: [],
  },
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
      timeLimitHours: 168,
    },
    integrations: DEFAULT_INTEGRATION_REWARD_RULES,
  },
  shop: {
    items: buildDefaultShopItems(),
  },
};

export async function getConfig(): Promise<ServerConfig> {
  const config = await readJson<ServerConfig>(getConfigPath());
  if (!config) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    meta: {
      ...DEFAULT_CONFIG.meta,
      ...config.meta,
      featureFlags: {
        ...DEFAULT_CONFIG.meta.featureFlags,
        ...config.meta?.featureFlags,
      },
    },
    polling: {
      ...DEFAULT_CONFIG.polling,
      ...config.polling,
      repos: config.polling?.repos ?? DEFAULT_CONFIG.polling.repos,
    },
    rewards: {
      ...DEFAULT_CONFIG.rewards,
      ...config.rewards,
      combo: {
        ...DEFAULT_CONFIG.rewards.combo,
        ...config.rewards?.combo,
      },
      encounter: {
        ...DEFAULT_CONFIG.rewards.encounter,
        ...config.rewards?.encounter,
      },
      integrations: mergeIntegrationRewardRules(config.rewards?.integrations),
    },
    shop: {
      ...DEFAULT_CONFIG.shop,
      ...config.shop,
      items: {
        ...DEFAULT_CONFIG.shop.items,
        ...config.shop?.items,
      },
    },
  };
}

export async function saveConfig(config: ServerConfig): Promise<void> {
  await writeJson(getConfigPath(), config);
}
