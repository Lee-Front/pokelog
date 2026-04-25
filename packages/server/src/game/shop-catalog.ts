import type { ShopItem, VitaminStatKey, PpBoostKind } from "../../../../shared/types.js";
import { getItems } from "./data-loader.js";

// Legacy item ids retained for backward compatibility with existing user
// inventories and saves. PokeAPI synced equivalents (poke-ball, super-potion,
// etc.) are skipped from generation so we don't create duplicate entries.
const LEGACY_ITEMS: Record<string, ShopItem> = {
  pokeball: { name: "Poke Ball", price: 100, catchBonus: 0 },
  greatball: { name: "Great Ball", price: 300, catchBonus: 0.2 },
  ultraball: { name: "Ultra Ball", price: 400, catchBonus: 0.35 },
  safariball: { name: "Safari Ball", price: 250, catchBonus: 0.1 },
  masterball: { name: "Master Ball", price: 50000, catchBonus: 0, guaranteedCatch: true },
  potion: { name: "Potion", price: 100, healAmount: 20 },
  superPotion: { name: "Super Potion", price: 350, healAmount: 60 },
  hyperPotion: { name: "Hyper Potion", price: 750, healAmount: 120 },
};

const SHOP_INCLUDE_CATEGORIES = new Set([
  "evolution",
  "healing",
  "revival",
  "pp-recovery",
  "status-cures",
  "medicine",
  "in-a-pinch",
  "type-protection",
  "effort-drop",
  "vitamins",
  "apricorn-balls",
  "special-balls",
  "all-machines",      // TMs (HMs filtered via SKIP_IDS)
  "type-enhancement",
  "bad-held-items",
  "held-items",
  "training",
]);

// Items inside included categories that we don't want sold:
// - HMs: we have no field moves so they cannot be used
// - Promo/event balls: cherish/park/premier are canon non-sellables
// - Encounter/breeding-only items: we have neither system
// - PokeAPI ids that conflict with our LEGACY_ITEMS
// - Auto-leveling candies (rare-candy, exp-candy-*, dynamax-candy):
//   bypass our exp/level economy
// - Stat-bonus candies/wings (Galar-specific minor EV): redundant with vitamins
const SKIP_IDS = new Set([
  // HMs
  "hm01", "hm02", "hm03", "hm04", "hm05", "hm06", "hm07", "hm08",
  // Non-sellable balls
  "premier-ball", "park-ball", "cherish-ball",
  // Encounter / breeding items (no field, no breeding)
  "cleanse-tag", "pure-incense", "luck-incense", "destiny-knot",
  // PokeAPI ids superseded by our LEGACY_ITEMS
  "poke-ball", "great-ball", "ultra-ball", "safari-ball", "master-ball",
  "super-potion", "hyper-potion",
  // Auto-level candies skip our exp economy
  "rare-candy", "dynamax-candy",
  "exp-candy-xs", "exp-candy-s", "exp-candy-m", "exp-candy-l", "exp-candy-xl",
  // Galar candy variants (per-stat EV grinders)
  "health-candy", "health-candy-l", "health-candy-xl",
  "courage-candy", "courage-candy-l", "courage-candy-xl",
  "mighty-candy", "mighty-candy-l", "mighty-candy-xl",
  "quick-candy", "quick-candy-l", "quick-candy-xl",
  "smart-candy", "smart-candy-l", "smart-candy-xl",
  "tough-candy", "tough-candy-l", "tough-candy-xl",
  // Galar wings (small +1 EV) — redundant with full vitamins
  "health-wing", "muscle-wing", "resist-wing",
  "genius-wing", "clever-wing", "swift-wing",
  // Battle-Frontier-only held items (canon: BP shop / raid drops only).
  // Reserved for Battle Tower rewards instead of mart purchase.
  "life-orb", "focus-sash", "leftovers", "eviolite", "assault-vest",
  "scope-lens", "expert-belt",
  "weakness-policy", "throat-spray", "eject-button", "eject-pack",
  "mental-herb", "white-herb", "power-herb", "mirror-herb",
  "covert-cloak", "ability-shield", "clear-amulet", "booster-energy",
  "loaded-dice", "punching-glove", "heavy-duty-boots", "safety-goggles",
  "big-root", "light-clay", "terrain-extender",
  "damp-rock", "heat-rock", "smooth-rock", "icy-rock",
  "electric-seed", "grassy-seed", "psychic-seed", "misty-seed",
  "black-sludge", "adrenaline-orb", "blunder-policy", "shed-shell",
  "snowball", "luminous-moss", "absorb-bulb", "cell-battery",
  "protective-pads", "utility-umbrella", "room-service",
  "red-card", "focus-band", "binding-band", "rocky-helmet", "shell-bell",
  "grip-claw", "float-stone", "air-balloon", "metronome",
  "pass-orb", "muscle-band", "wise-glasses", "lax-incense", "ring-target",
  "lagging-tail", "sticky-barb", "full-incense",
]);

// Manual price overrides for items where the canon × 0.5 formula would
// produce a misleading number (e.g., raid drops with placeholder cost).
const PRICE_OVERRIDES: Record<string, number> = {
  "pp-max": 8000,            // canon ties pp-up at 9800; bump pp-max higher
  "ability-patch": 12500,    // canon raid drop, PokeAPI cost is placeholder 20
  "ability-capsule": 5000,
};

// Default prices for items where PokeAPI cost is 0 (canon: not sold or BP-only).
// Without a fallback the item is skipped entirely.
const COST_FALLBACK: Record<string, number> = {
  // Apricorn balls (canon: Kurt-crafted from apricorns; we have no apricorns)
  "fast-ball": 1500,
  "friend-ball": 1500,
  "heavy-ball": 1500,
  "level-ball": 1500,
  "love-ball": 1500,
  "lure-ball": 1500,
  "moon-ball": 1500,
  // Special balls (canon: rare drops)
  "beast-ball": 5000,
  "dream-ball": 1500,
  // Held items with cost=0 (canon: BP-only)
  "booster-energy": 8000,
  "exp-share": 5000,
};

// Per-id catch metadata. Bonuses approximate the canon ball multipliers
// without trying to reproduce per-context conditions (water-only, etc.).
const CATCH_BONUSES: Record<string, { catchBonus?: number; guaranteedCatch?: boolean }> = {
  // PokeAPI special-balls
  "dive-ball": { catchBonus: 0.2 },
  "dusk-ball": { catchBonus: 0.2 },
  "heal-ball": { catchBonus: 0 },
  "luxury-ball": { catchBonus: 0 },
  "net-ball": { catchBonus: 0.3 },
  "nest-ball": { catchBonus: 0.2 },
  "quick-ball": { catchBonus: 0.3 },
  "repeat-ball": { catchBonus: 0.2 },
  "timer-ball": { catchBonus: 0.2 },
  "beast-ball": { catchBonus: 0 },
  "dream-ball": { catchBonus: 0.1 },
  // Apricorn balls (canon: situational multipliers)
  "fast-ball": { catchBonus: 0.2 },
  "friend-ball": { catchBonus: 0 },
  "heavy-ball": { catchBonus: 0.2 },
  "level-ball": { catchBonus: 0.2 },
  "love-ball": { catchBonus: 0.2 },
  "lure-ball": { catchBonus: 0.2 },
  "moon-ball": { catchBonus: 0.2 },
};

// Heal amounts (HP) from canon. status-cure items use STATUS_CURE_MAP
// inside item-usage.ts, not healAmount.
const HEALING_AMOUNTS: Record<string, number> = {
  "max-potion": 999,
  "full-restore": 999,
  "fresh-water": 50,
  "soda-pop": 60,
  lemonade: 80,
  "moomoo-milk": 100,
  "berry-juice": 20,
  "energy-powder": 50,
  "energy-root": 200,
  "heal-powder": 0,
  "sweet-heart": 20,
  // revival items handle their own logic in useInventoryItem; healAmount
  // for them is informational only
  revive: 0,
  "max-revive": 0,
  "max-honey": 0,
  "revival-herb": 0,
  "sacred-ash": 0,
  // pp-recovery items don't restore HP either
  ether: 0,
  "max-ether": 0,
  elixir: 0,
  "max-elixir": 0,
};

const VITAMIN_STATS: Record<string, VitaminStatKey> = {
  "hp-up": "hp",
  protein: "attack",
  iron: "defense",
  calcium: "spAttack",
  zinc: "spDefense",
  carbos: "speed",
};

const PP_BOOSTS: Record<string, PpBoostKind> = {
  "pp-up": "increment",
  "pp-max": "max",
};

const PRICE_ROUND_TO = 50;
const PRICE_SCALE = 0.5;

function applyPriceFormula(canonCost: number, fallback: number | undefined): number {
  const source = canonCost > 0 ? canonCost * PRICE_SCALE : (fallback ?? 0);
  if (source <= 0) return 0;
  return Math.max(PRICE_ROUND_TO, Math.round(source / PRICE_ROUND_TO) * PRICE_ROUND_TO);
}

export function buildDefaultShopItems(): Record<string, ShopItem> {
  const result: Record<string, ShopItem> = {};

  for (const item of getItems()) {
    if (!SHOP_INCLUDE_CATEGORIES.has(item.category)) continue;
    if (SKIP_IDS.has(item.id)) continue;
    // Skip ids reserved for legacy entries so the legacy ShopItem (with
    // its hand-tuned healAmount/catchBonus etc.) is the canonical one.
    if (Object.prototype.hasOwnProperty.call(LEGACY_ITEMS, item.id)) continue;

    // Items in the vitamins category that are not actual stat vitamins or
    // PP boosters or ability changers should be skipped (most are listed
    // explicitly in SKIP_IDS but guard the rest defensively).
    if (item.category === "vitamins") {
      const isStatVitamin = item.id in VITAMIN_STATS;
      const isPpBoost = item.id in PP_BOOSTS;
      const isAbilityItem = item.id === "ability-capsule" || item.id === "ability-patch";
      if (!isStatVitamin && !isPpBoost && !isAbilityItem) continue;
    }

    const fallback = COST_FALLBACK[item.id];
    const override = PRICE_OVERRIDES[item.id];
    const price = override ?? applyPriceFormula(item.cost ?? 0, fallback);
    if (price <= 0) continue;

    const shopItem: ShopItem = { name: item.name, price };

    if (HEALING_AMOUNTS[item.id] !== undefined) {
      shopItem.healAmount = HEALING_AMOUNTS[item.id];
    }

    const catchMeta = CATCH_BONUSES[item.id];
    if (catchMeta) {
      if (catchMeta.catchBonus !== undefined) shopItem.catchBonus = catchMeta.catchBonus;
      if (catchMeta.guaranteedCatch) shopItem.guaranteedCatch = true;
    }

    if (VITAMIN_STATS[item.id]) shopItem.vitaminStat = VITAMIN_STATS[item.id];
    if (PP_BOOSTS[item.id]) shopItem.ppBoost = PP_BOOSTS[item.id];

    result[item.id] = shopItem;
  }

  // Legacy entries last so their tuned metadata wins over any PokeAPI
  // duplicate (e.g., the canonical "potion" id appears in items.json too).
  for (const [id, entry] of Object.entries(LEGACY_ITEMS)) {
    result[id] = entry;
  }

  return result;
}
