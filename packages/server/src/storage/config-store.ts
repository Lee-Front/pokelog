import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { ServerConfig } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { DEFAULT_INTEGRATION_REWARD_RULES, mergeIntegrationRewardRules } from "../integrations/event-catalog.js";
import { DEFAULT_SHINY_RATE, refreshShinyRate } from "../game/shiny.js";

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

// 메가진화용 아이템 — 키스톤(모든 메가 해금 게이트, 1회성) + 메가스톤 47종. 배틀머니 상점 판매.
// 메가스톤 id는 canMegaEvolve가 기대하는 heldItem(=variantIdToMegaStone)과 일치한다.
const DEFAULT_MEGA_SHOP_ITEMS = {
  "abomasnowite": { name: "Abomasnowite", price: 500 },
  "absolite": { name: "Absolite", price: 500 },
  "aerodactylite": { name: "Aerodactylite", price: 500 },
  "aggronite": { name: "Aggronite", price: 500 },
  "alakazamite": { name: "Alakazamite", price: 500 },
  "altarianite": { name: "Altarianite", price: 500 },
  "ampharosite": { name: "Ampharosite", price: 500 },
  "audinite": { name: "Audinite", price: 500 },
  "banettite": { name: "Banettite", price: 500 },
  "beedrillite": { name: "Beedrillite", price: 500 },
  "blastoisinite": { name: "Blastoisinite", price: 500 },
  "blazikenite": { name: "Blazikenite", price: 500 },
  "cameruptite": { name: "Cameruptite", price: 500 },
  "charizardite-x": { name: "Charizardite X", price: 500 },
  "charizardite-y": { name: "Charizardite Y", price: 500 },
  "diancite": { name: "Diancite", price: 500 },
  "galladite": { name: "Galladite", price: 500 },
  "garchompite": { name: "Garchompite", price: 500 },
  "gardevoirite": { name: "Gardevoirite", price: 500 },
  "gengarite": { name: "Gengarite", price: 500 },
  "glalite": { name: "Glalite", price: 500 },
  "gyaradosite": { name: "Gyaradosite", price: 500 },
  "heracrossite": { name: "Heracrossite", price: 500 },
  "houndoomite": { name: "Houndoomite", price: 500 },
  "kangaskhanite": { name: "Kangaskhanite", price: 500 },
  "latiasite": { name: "Latiasite", price: 500 },
  "latiosite": { name: "Latiosite", price: 500 },
  "lopunnite": { name: "Lopunnite", price: 500 },
  "lucarionite": { name: "Lucarionite", price: 500 },
  "manectite": { name: "Manectite", price: 500 },
  "mawilite": { name: "Mawilite", price: 500 },
  "medichamite": { name: "Medichamite", price: 500 },
  "metagrossite": { name: "Metagrossite", price: 500 },
  "mewtwonite-x": { name: "Mewtwonite X", price: 500 },
  "mewtwonite-y": { name: "Mewtwonite Y", price: 500 },
  "pidgeotite": { name: "Pidgeotite", price: 500 },
  "pinsirite": { name: "Pinsirite", price: 500 },
  "sablenite": { name: "Sablenite", price: 500 },
  "salamencite": { name: "Salamencite", price: 500 },
  "sceptilite": { name: "Sceptilite", price: 500 },
  "scizorite": { name: "Scizorite", price: 500 },
  "sharpedoite": { name: "Sharpedoite", price: 500 },
  "slowbronite": { name: "Slowbronite", price: 500 },
  "steelixite": { name: "Steelixite", price: 500 },
  "swampertite": { name: "Swampertite", price: 500 },
  "tyranitarite": { name: "Tyranitarite", price: 500 },
  "venusaurite": { name: "Venusaurite", price: 500 },
  "key-stone": { name: "Key Stone", price: 1000 },
} satisfies ServerConfig["shop"]["items"];

// 거다이맥스용 아이템 — 다이맥스밴드(모든 거다이 해금 게이트, 재사용·키스톤과 동급) +
// 맥스 수프(개체별 1회 기가팩터 해금). 배틀머니 상점 판매.
// dynamax-band id는 canGigantamax가 기대하는 userInventory 키와 일치한다.
const DEFAULT_GMAX_SHOP_ITEMS = {
  "dynamax-band": { name: "Dynamax Band", price: 5000 },
  "max-soup": { name: "Max Soup", price: 500 },
} satisfies ServerConfig["shop"]["items"];

export const DEFAULT_CONFIG: ServerConfig = {
  server: { port: 3000, corsAllowedOrigins: [] },
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
    // Conservative launch defaults (~1/10 of the original byte rate, gentler
    // combo curve). Operators raise these over time via PUT /api/admin/config
    // as real-user feedback comes in.
    expPerByte: 0.05,
    pointsPerByte: 0.01,
    combo: {
      bytesPerMinute: 10,
      multipliers: [1, 1.2, 1.5],
      maxMultiplier: 1.5,
    },
    encounter: {
      baseChance: 0.3,
      ceilingBytes: 5000,
      timeLimitHours: 168,
      // 포인트 소비 야생 탐색 비용. 알 가챠 common(120P)보다 약간 싸게 시작.
      searchCost: 100,
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
  // Conservative wild-battle reward defaults (match the cautious points/combo
  // launch tuning). Operators raise these via PUT /api/admin/config over time.
  // Drop-table and battleShop item ids are real data/items/items.json ids.
  battle: {
    expMultiplier: 1.0,
    moneyPerLevel: 2,
    moneyBase: 3,
    dropTable: [
      { item: "potion", chance: 0.08, min: 1, max: 1 },
      { item: "super-potion", chance: 0.03, min: 1, max: 1 },
      { item: "poke-ball", chance: 0.05, min: 1, max: 1 },
      { item: "great-ball", chance: 0.015, min: 1, max: 1 },
    ],
  },
  battleShop: {
    items: {
      "super-potion": { name: "Super Potion", price: 30, healAmount: 50 },
      "hyper-potion": { name: "Hyper Potion", price: 60, healAmount: 120 },
      "great-ball": { name: "Great Ball", price: 25, catchBonus: 0.2 },
      "ultra-ball": { name: "Ultra Ball", price: 70, catchBonus: 0.35 },
      "fire-stone": { name: "Fire Stone", price: 200 },
      ...DEFAULT_MEGA_SHOP_ITEMS,
      ...DEFAULT_GMAX_SHOP_ITEMS,
    },
  },
  // 알 가챠 기본값 — 단일 풀 + 티어별 등급 버킷 등장확률. legendary/rare 확률만 노브이고
  // common 버킷은 파생(1 - legendary - rare). 티어가 높을수록 전설·희귀 비중이 커진다.
  // 운영자가 /admin에서 튜닝한다.
  egg: {
    common: { cost: 120, minLevel: 1, maxLevel: 6, legendaryChance: 0.002, rareChance: 0.12 },
    rare: { cost: 450, minLevel: 5, maxLevel: 12, legendaryChance: 0.01, rareChance: 0.4 },
    legend: { cost: 3200, minLevel: 15, maxLevel: 25, legendaryChance: 0.03, rareChance: 0.47 },
  },
  shinyRate: DEFAULT_SHINY_RATE,
  // PvP 설정(Phase 2). 모든 매치는 에스크로(내기) 단일 경로 — 빈 stake가 친선.
  // ELO는 시작 1000·K 32. 운영자가 /admin에서 튜닝한다.
  pvp: {
    elo: { start: 1000, k: 32 },
  },
};

export async function getConfig(): Promise<ServerConfig> {
  const config = await readJson<ServerConfig>(getConfigPath());
  if (!config) {
    refreshShinyRate(DEFAULT_CONFIG.shinyRate);
    return { ...DEFAULT_CONFIG };
  }

  // 이로치 확률은 동기 팩토리(createPokemon)가 동기 getShinyRate()로 읽으므로,
  // config funnel인 여기서 캐시를 갱신한다. 유효하지 않은 값은 모듈에서 기본값 폴백.
  refreshShinyRate(config.shinyRate);

  return {
    ...DEFAULT_CONFIG,
    ...config,
    server: {
      ...DEFAULT_CONFIG.server,
      ...config.server,
    },
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
    battle: {
      ...DEFAULT_CONFIG.battle,
      ...config.battle,
      dropTable: config.battle?.dropTable ?? DEFAULT_CONFIG.battle.dropTable,
    },
    battleShop: {
      ...DEFAULT_CONFIG.battleShop,
      ...config.battleShop,
      items: {
        ...DEFAULT_CONFIG.battleShop.items,
        ...config.battleShop?.items,
      },
    },
    egg: {
      common: { ...DEFAULT_CONFIG.egg.common, ...config.egg?.common },
      rare: { ...DEFAULT_CONFIG.egg.rare, ...config.egg?.rare },
      legend: { ...DEFAULT_CONFIG.egg.legend, ...config.egg?.legend },
    },
    shinyRate: config.shinyRate ?? DEFAULT_CONFIG.shinyRate,
    pvp: {
      ...DEFAULT_CONFIG.pvp,
      ...config.pvp,
      elo: { ...DEFAULT_CONFIG.pvp.elo, ...config.pvp?.elo },
    },
  };
}

export async function saveConfig(config: ServerConfig): Promise<void> {
  await writeJson(getConfigPath(), config);
}
