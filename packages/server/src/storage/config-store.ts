import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { ServerConfig } from "../../../../shared/types.js";

const DATA_DIR = process.env.POKELOG_DATA_DIR || "pokelog-data";
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

export const DEFAULT_CONFIG: ServerConfig = {
  server: { port: 3000 },
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
      timeLimitHours: 24,
    },
  },
  shop: {
    items: {
      pokeball: { name: "Poke Ball", price: 100, catchBonus: 0 },
      greatball: { name: "Great Ball", price: 300, catchBonus: 0.15 },
      ultraball: { name: "Ultra Ball", price: 800, catchBonus: 0.3 },
      potion: { name: "Potion", price: 150, healAmount: 20 },
      superPotion: { name: "Super Potion", price: 400, healAmount: 50 },
      hyperPotion: { name: "Hyper Potion", price: 800, healAmount: 120 },
    },
  },
};

export async function getConfig(): Promise<ServerConfig> {
  const config = await readJson<ServerConfig>(CONFIG_PATH);
  return config ?? { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: ServerConfig): Promise<void> {
  await writeJson(CONFIG_PATH, config);
}
