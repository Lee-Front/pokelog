import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { ServerConfig } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { DEFAULT_INTEGRATION_REWARD_RULES, mergeIntegrationRewardRules } from "../integrations/event-catalog.js";

function getConfigPath() {
  return path.join(getDataDir(), "config.json");
}

const DEFAULT_EVOLUTION_SHOP_ITEMS = {
  "black-augurite": { name: "Black Augurite", price: 3000 },
  "cracked-pot": { name: "Cracked Pot", price: 1600 },
  "dawn-stone": { name: "Dawn Stone", price: 3000 },
  "dusk-stone": { name: "Dusk Stone", price: 3000 },
  "fire-stone": { name: "Fire Stone", price: 3000 },
  "galarica-cuff": { name: "Galarica Cuff", price: 3000 },
  "galarica-wreath": { name: "Galarica Wreath", price: 3000 },
  "ice-stone": { name: "Ice Stone", price: 3000 },
  "leaf-stone": { name: "Leaf Stone", price: 3000 },
  "moon-stone": { name: "Moon Stone", price: 3000 },
  "peat-block": { name: "Peat Block", price: 3000 },
  "shiny-stone": { name: "Shiny Stone", price: 3000 },
  "sun-stone": { name: "Sun Stone", price: 3000 },
  "sweet-apple": { name: "Sweet Apple", price: 2200 },
  "tart-apple": { name: "Tart Apple", price: 2200 },
  "thunder-stone": { name: "Thunder Stone", price: 3000 },
  "water-stone": { name: "Water Stone", price: 3000 },
} satisfies ServerConfig["shop"]["items"];

const DEFAULT_HELD_EVOLUTION_SHOP_ITEMS = {
  "deep-sea-scale": { name: "Deep Sea Scale", price: 2000 },
  "deep-sea-tooth": { name: "Deep Sea Tooth", price: 2000 },
  "dragon-scale": { name: "Dragon Scale", price: 2000 },
  "dubious-disc": { name: "Dubious Disc", price: 2000 },
  electirizer: { name: "Electirizer", price: 2000 },
  "kings-rock": { name: "King's Rock", price: 5000 },
  magmarizer: { name: "Magmarizer", price: 2000 },
  "metal-coat": { name: "Metal Coat", price: 2000 },
  "oval-stone": { name: "Oval Stone", price: 2000 },
  "prism-scale": { name: "Prism Scale", price: 2000 },
  protector: { name: "Protector", price: 2000 },
  "razor-claw": { name: "Razor Claw", price: 5000 },
  "razor-fang": { name: "Razor Fang", price: 2000 },
  "reaper-cloth": { name: "Reaper Cloth", price: 2000 },
  sachet: { name: "Sachet", price: 2000 },
  "up-grade": { name: "Up-Grade", price: 2000 },
  "whipped-dream": { name: "Whipped Dream", price: 2000 },
} satisfies ServerConfig["shop"]["items"];

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
      pokeball: { name: "Poke Ball", price: 100, catchBonus: 0 },
      safariball: { name: "Safari Ball", price: 250, catchBonus: 0.1 },
      greatball: { name: "Great Ball", price: 350, catchBonus: 0.2 },
      ultraball: { name: "Ultra Ball", price: 900, catchBonus: 0.35 },
      masterball: { name: "Master Ball", price: 50000, catchBonus: 0, guaranteedCatch: true },
      potion: { name: "Potion", price: 150, healAmount: 20 },
      superPotion: { name: "Super Potion", price: 400, healAmount: 50 },
      hyperPotion: { name: "Hyper Potion", price: 800, healAmount: 120 },
      ...DEFAULT_EVOLUTION_SHOP_ITEMS,
      ...DEFAULT_HELD_EVOLUTION_SHOP_ITEMS,
    },
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
