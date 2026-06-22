import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { ServerConfig } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { DEFAULT_INTEGRATION_REWARD_RULES, mergeIntegrationRewardRules } from "../integrations/event-catalog.js";
import { DEFAULT_SHINY_RATE, refreshShinyRate } from "../game/shiny.js";

function getConfigPath() {
  return path.join(getDataDir(), "config.json");
}

// 진화의 돌·진화용 아이템 — 게임머니 상점 "특수아이템(special)" 카테고리.
const DEFAULT_EVOLUTION_SHOP_ITEMS = {
  "black-augurite": { name: "Black Augurite", price: 3000, category: "special" },
  "cracked-pot": { name: "Cracked Pot", price: 1600, category: "special" },
  "dawn-stone": { name: "Dawn Stone", price: 3000, category: "special" },
  "dusk-stone": { name: "Dusk Stone", price: 3000, category: "special" },
  "fire-stone": { name: "Fire Stone", price: 3000, category: "special" },
  "galarica-cuff": { name: "Galarica Cuff", price: 3000, category: "special" },
  "galarica-wreath": { name: "Galarica Wreath", price: 3000, category: "special" },
  "ice-stone": { name: "Ice Stone", price: 3000, category: "special" },
  "leaf-stone": { name: "Leaf Stone", price: 3000, category: "special" },
  "moon-stone": { name: "Moon Stone", price: 3000, category: "special" },
  "peat-block": { name: "Peat Block", price: 3000, category: "special" },
  "shiny-stone": { name: "Shiny Stone", price: 3000, category: "special" },
  "sun-stone": { name: "Sun Stone", price: 3000, category: "special" },
  "sweet-apple": { name: "Sweet Apple", price: 2200, category: "special" },
  "tart-apple": { name: "Tart Apple", price: 2200, category: "special" },
  "thunder-stone": { name: "Thunder Stone", price: 3000, category: "special" },
  "water-stone": { name: "Water Stone", price: 3000, category: "special" },
} satisfies ServerConfig["shop"]["items"];

// 지닌 채 진화하는 아이템(딥씨스케일 등) — 게임머니 상점 "특수아이템(special)" 카테고리.
const DEFAULT_HELD_EVOLUTION_SHOP_ITEMS = {
  "deep-sea-scale": { name: "Deep Sea Scale", price: 2000, category: "special" },
  "deep-sea-tooth": { name: "Deep Sea Tooth", price: 2000, category: "special" },
  "dragon-scale": { name: "Dragon Scale", price: 2000, category: "special" },
  "dubious-disc": { name: "Dubious Disc", price: 2000, category: "special" },
  electirizer: { name: "Electirizer", price: 2000, category: "special" },
  "kings-rock": { name: "King's Rock", price: 5000, category: "special" },
  magmarizer: { name: "Magmarizer", price: 2000, category: "special" },
  "metal-coat": { name: "Metal Coat", price: 2000, category: "special" },
  "oval-stone": { name: "Oval Stone", price: 2000, category: "special" },
  "prism-scale": { name: "Prism Scale", price: 2000, category: "special" },
  protector: { name: "Protector", price: 2000, category: "special" },
  "razor-claw": { name: "Razor Claw", price: 5000, category: "special" },
  "razor-fang": { name: "Razor Fang", price: 2000, category: "special" },
  "reaper-cloth": { name: "Reaper Cloth", price: 2000, category: "special" },
  sachet: { name: "Sachet", price: 2000, category: "special" },
  "up-grade": { name: "Up-Grade", price: 2000, category: "special" },
  "whipped-dream": { name: "Whipped Dream", price: 2000, category: "special" },
} satisfies ServerConfig["shop"]["items"];

// 메가진화용 아이템 — 키스톤(모든 메가 해금 게이트, 1회성) + 메가스톤 47종. 게임머니 상점 "특수아이템(special)".
// 메가스톤 id는 canMegaEvolve가 기대하는 heldItem(=variantIdToMegaStone)과 일치한다.
const DEFAULT_MEGA_SHOP_ITEMS = {
  "abomasnowite": { name: "Abomasnowite", price: 500, category: "special" },
  "absolite": { name: "Absolite", price: 500, category: "special" },
  "aerodactylite": { name: "Aerodactylite", price: 500, category: "special" },
  "aggronite": { name: "Aggronite", price: 500, category: "special" },
  "alakazamite": { name: "Alakazamite", price: 500, category: "special" },
  "altarianite": { name: "Altarianite", price: 500, category: "special" },
  "ampharosite": { name: "Ampharosite", price: 500, category: "special" },
  "audinite": { name: "Audinite", price: 500, category: "special" },
  "banettite": { name: "Banettite", price: 500, category: "special" },
  "beedrillite": { name: "Beedrillite", price: 500, category: "special" },
  "blastoisinite": { name: "Blastoisinite", price: 500, category: "special" },
  "blazikenite": { name: "Blazikenite", price: 500, category: "special" },
  "cameruptite": { name: "Cameruptite", price: 500, category: "special" },
  "charizardite-x": { name: "Charizardite X", price: 500, category: "special" },
  "charizardite-y": { name: "Charizardite Y", price: 500, category: "special" },
  "diancite": { name: "Diancite", price: 500, category: "special" },
  "galladite": { name: "Galladite", price: 500, category: "special" },
  "garchompite": { name: "Garchompite", price: 500, category: "special" },
  "gardevoirite": { name: "Gardevoirite", price: 500, category: "special" },
  "gengarite": { name: "Gengarite", price: 500, category: "special" },
  "glalite": { name: "Glalite", price: 500, category: "special" },
  "gyaradosite": { name: "Gyaradosite", price: 500, category: "special" },
  "heracrossite": { name: "Heracrossite", price: 500, category: "special" },
  "houndoomite": { name: "Houndoomite", price: 500, category: "special" },
  "kangaskhanite": { name: "Kangaskhanite", price: 500, category: "special" },
  "latiasite": { name: "Latiasite", price: 500, category: "special" },
  "latiosite": { name: "Latiosite", price: 500, category: "special" },
  "lopunnite": { name: "Lopunnite", price: 500, category: "special" },
  "lucarionite": { name: "Lucarionite", price: 500, category: "special" },
  "manectite": { name: "Manectite", price: 500, category: "special" },
  "mawilite": { name: "Mawilite", price: 500, category: "special" },
  "medichamite": { name: "Medichamite", price: 500, category: "special" },
  "metagrossite": { name: "Metagrossite", price: 500, category: "special" },
  "mewtwonite-x": { name: "Mewtwonite X", price: 500, category: "special" },
  "mewtwonite-y": { name: "Mewtwonite Y", price: 500, category: "special" },
  "pidgeotite": { name: "Pidgeotite", price: 500, category: "special" },
  "pinsirite": { name: "Pinsirite", price: 500, category: "special" },
  "sablenite": { name: "Sablenite", price: 500, category: "special" },
  "salamencite": { name: "Salamencite", price: 500, category: "special" },
  "sceptilite": { name: "Sceptilite", price: 500, category: "special" },
  "scizorite": { name: "Scizorite", price: 500, category: "special" },
  "sharpedoite": { name: "Sharpedoite", price: 500, category: "special" },
  "slowbronite": { name: "Slowbronite", price: 500, category: "special" },
  "steelixite": { name: "Steelixite", price: 500, category: "special" },
  "swampertite": { name: "Swampertite", price: 500, category: "special" },
  "tyranitarite": { name: "Tyranitarite", price: 500, category: "special" },
  "venusaurite": { name: "Venusaurite", price: 500, category: "special" },
  "key-stone": { name: "Key Stone", price: 1000, category: "special" },
} satisfies ServerConfig["shop"]["items"];

// 거다이맥스용 아이템 — 다이맥스밴드(모든 거다이 해금 게이트, 재사용·키스톤과 동급) +
// 맥스 수프(개체별 1회 기가팩터 해금). 게임머니 상점 "특수아이템(special)".
// dynamax-band id는 canGigantamax가 기대하는 userInventory 키와 일치한다.
const DEFAULT_GMAX_SHOP_ITEMS = {
  "dynamax-band": { name: "Dynamax Band", price: 5000, category: "special" },
  "max-soup": { name: "Max Soup", price: 500, category: "special" },
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
      // 포인트 소비 야생 탐색 비용(레거시). 탐색은 무료 일괄 롤로 바뀌어 더 이상
      // 게이트가 아니다. 응답에는 정보성으로 남는다.
      searchCost: 100,
      // 무료 "탐색" 1회가 생성하는 야생 조우 개수(일괄 롤). 보드를 통째로 교체한다.
      rollCount: 12,
    },
    integrations: DEFAULT_INTEGRATION_REWARD_RULES,
  },
  // 포인트 상점(커밋으로 버는 points 재화) — 마스터볼 + 영양제 6종만 판매.
  // 그 외 소비/진화/메가/거다이 아이템은 모두 게임머니 상점(battleShop)으로 이동했다.
  // (알 가챠는 별도 시스템이라 여기와 무관.)
  shop: {
    items: {
      masterball: { name: "Master Ball", price: 50000, catchBonus: 0, guaranteedCatch: true },
      // 영양제 — 지정 노력치를 +10. 키는 영양제 아이템 id(VITAMIN_STAT)와 일치시켜
      // 구매(인벤토리 키)→사용(VITAMIN_STAT 조회)이 동일 네임스페이스로 이어지게 한다.
      protein: { name: "단백질", price: 3000 },
      calcium: { name: "칼슘", price: 3000 },
      iron: { name: "철분", price: 3000 },
      zinc: { name: "아연", price: 3000 },
      carbos: { name: "카르본", price: 3000 },
      "hp-up": { name: "맥스업", price: 3000 },
    },
  },
  // Conservative wild-battle reward defaults (match the cautious points/combo
  // launch tuning). Operators raise these via PUT /api/admin/config over time.
  // 드랍·배틀상점 아이템 id는 **인벤토리/전투 가방 네임스페이스(무하이픈)** 와 일치해야 한다
  // (config.shop.items 키와 동일 체계: pokeball/greatball/superPotion…). items.json 하이픈
  // id(poke-ball 등)로 주면 전투 가방·catch/heal이 인식 못 해 죽은 키가 된다.
  battle: {
    expMultiplier: 1.0,
    moneyPerLevel: 2,
    moneyBase: 3,
    dropTable: [
      { item: "potion", chance: 0.08, min: 1, max: 1 },
      { item: "superPotion", chance: 0.03, min: 1, max: 1 },
      { item: "pokeball", chance: 0.05, min: 1, max: 1 },
      { item: "greatball", chance: 0.015, min: 1, max: 1 },
    ],
  },
  // 게임머니 상점(야생 전투로 버는 gameMoney 재화) — 포털에서 카테고리 탭으로 노출한다:
  //   potion(물약)·ball(몬스터볼)·special(특수아이템: 진화/메가/거다이/키스톤 등).
  // 인벤토리 키 네임스페이스는 기존 규약 유지(볼/물약=무하이픈 camelCase, 돌=하이픈 id).
  // 구 포인트 상점에 있던 볼·물약을 여기로 옮겼고, 진화의돌 fire-stone은
  // DEFAULT_EVOLUTION_SHOP_ITEMS가 제공하므로 중복 항목은 제거했다.
  battleShop: {
    items: {
      // 물약(potion)
      potion: { name: "Potion", price: 8, healAmount: 20, category: "potion" },
      superPotion: { name: "Super Potion", price: 30, healAmount: 50, category: "potion" },
      hyperPotion: { name: "Hyper Potion", price: 60, healAmount: 120, category: "potion" },
      // 몬스터볼(ball)
      pokeball: { name: "Poke Ball", price: 10, catchBonus: 0, category: "ball" },
      safariball: { name: "Safari Ball", price: 20, catchBonus: 0.1, category: "ball" },
      greatball: { name: "Great Ball", price: 25, catchBonus: 0.2, category: "ball" },
      ultraball: { name: "Ultra Ball", price: 70, catchBonus: 0.35, category: "ball" },
      // 특수아이템(special) — 진화의돌/지닌진화/메가스톤/키스톤/거다이
      ...DEFAULT_EVOLUTION_SHOP_ITEMS,
      ...DEFAULT_HELD_EVOLUTION_SHOP_ITEMS,
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
