import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { ServerConfig } from "../../../../shared/types.js";
import { DATA_DIR } from "../paths.js";
import { DEFAULT_INTEGRATION_REWARD_RULES, mergeIntegrationRewardRules } from "../integrations/event-catalog.js";
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export const DEFAULT_CONFIG: ServerConfig = {
  server: { port: 3000 },
  meta: {
    serverId: "default",
    serverName: "local",
    displayName: "PokeLog Server",
    apiVersion: "1",
    featureFlags: {
      pvp: false,
      trade: false,
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
    items: {
      pokeball:   { name: "몬스터볼",  price: 100,   catchBonus: 0 },
      safariball: { name: "사파리볼",  price: 250,   catchBonus: 0.1 },
      greatball:  { name: "수퍼볼",    price: 350,   catchBonus: 0.2 },
      ultraball:  { name: "하이퍼볼",  price: 900,   catchBonus: 0.35 },
      masterball: { name: "마스터볼",  price: 50000, catchBonus: 0, guaranteedCatch: true },
      potion:       { name: "상처약",      price: 150, healAmount: 20 },
      superPotion:  { name: "좋은 상처약", price: 400, healAmount: 50 },
      hyperPotion:  { name: "고급 상처약", price: 800, healAmount: 120 },
    },
  },
};

export async function getConfig(): Promise<ServerConfig> {
  const config = await readJson<ServerConfig>(CONFIG_PATH);
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
      items: config.shop?.items ?? DEFAULT_CONFIG.shop.items,
    },
  };
}

export async function saveConfig(config: ServerConfig): Promise<void> {
  await writeJson(CONFIG_PATH, config);
}
