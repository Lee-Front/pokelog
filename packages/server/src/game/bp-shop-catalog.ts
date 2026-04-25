import { getItemById } from "./data-loader.js";

export interface BpShopEntry {
  /** Item id (PokeAPI canonical). */
  id: string;
  /** Display name (Korean if available, else English). */
  name: string;
  /** Battle Points cost to acquire one unit. */
  bp: number;
  /** Optional grouping hint for UI sectioning. */
  category: BpShopCategory;
}

export type BpShopCategory =
  | "core-held"
  | "choice"
  | "buffer"
  | "field-rock"
  | "terrain-seed"
  | "training"
  | "nature-mint"
  | "transform"
  | "rare";

// Battle Frontier price tiers, modeled after canon BP costs.
//   common = 16 BP   (utility held items, white-herb / mental-herb tier)
//   mid    = 32 BP   (leftovers, scope-lens, expert-belt tier)
//   high   = 48 BP   (life-orb, focus-sash, choice items, nature mints)
//   prime  = 64 BP   (eviolite, assault-vest, weakness-policy)
//   rare   = 100 BP  (ability-capsule)
//   legend = 200 BP  (ability-patch, sacred-ash)
// Mega evolution / Z-crystals / plates / tera shards are intentionally
// not surfaced — those mechanics are optional in our game and don't need
// a purchase path.
const TIER = {
  common: 16,
  mid: 32,
  high: 48,
  prime: 64,
  rare: 100,
  legend: 200,
} as const;

interface BpItemSpec {
  id: string;
  bp: number;
  category: BpShopCategory;
}

const BP_ITEM_SPECS: BpItemSpec[] = [
  // Core competitive held items (canon: BP shop standard offering)
  { id: "leftovers", bp: TIER.mid, category: "core-held" },
  { id: "life-orb", bp: TIER.high, category: "core-held" },
  { id: "focus-sash", bp: TIER.high, category: "core-held" },
  { id: "eviolite", bp: TIER.prime, category: "core-held" },
  { id: "assault-vest", bp: TIER.prime, category: "core-held" },
  { id: "expert-belt", bp: TIER.mid, category: "core-held" },
  { id: "scope-lens", bp: TIER.mid, category: "core-held" },
  { id: "weakness-policy", bp: TIER.prime, category: "core-held" },
  { id: "throat-spray", bp: TIER.mid, category: "core-held" },
  { id: "covert-cloak", bp: TIER.high, category: "core-held" },
  { id: "ability-shield", bp: TIER.high, category: "core-held" },
  { id: "clear-amulet", bp: TIER.high, category: "core-held" },
  { id: "loaded-dice", bp: TIER.mid, category: "core-held" },
  { id: "punching-glove", bp: TIER.mid, category: "core-held" },
  { id: "heavy-duty-boots", bp: TIER.high, category: "core-held" },
  { id: "safety-goggles", bp: TIER.mid, category: "core-held" },
  { id: "mirror-herb", bp: TIER.mid, category: "core-held" },
  { id: "booster-energy", bp: TIER.high, category: "core-held" },
  { id: "rocky-helmet", bp: TIER.mid, category: "core-held" },
  { id: "shell-bell", bp: TIER.common, category: "core-held" },
  { id: "muscle-band", bp: TIER.common, category: "core-held" },
  { id: "wise-glasses", bp: TIER.common, category: "core-held" },
  { id: "metronome", bp: TIER.common, category: "core-held" },
  { id: "big-root", bp: TIER.common, category: "core-held" },

  // Choice items
  { id: "choice-band", bp: TIER.high, category: "choice" },
  { id: "choice-specs", bp: TIER.high, category: "choice" },
  { id: "choice-scarf", bp: TIER.high, category: "choice" },

  // Single-use buffers / utility orbs
  { id: "white-herb", bp: TIER.common, category: "buffer" },
  { id: "mental-herb", bp: TIER.common, category: "buffer" },
  { id: "power-herb", bp: TIER.common, category: "buffer" },
  { id: "eject-button", bp: TIER.common, category: "buffer" },
  { id: "eject-pack", bp: TIER.common, category: "buffer" },
  { id: "red-card", bp: TIER.common, category: "buffer" },
  { id: "absorb-bulb", bp: TIER.common, category: "buffer" },
  { id: "cell-battery", bp: TIER.common, category: "buffer" },
  { id: "luminous-moss", bp: TIER.common, category: "buffer" },
  { id: "snowball", bp: TIER.common, category: "buffer" },
  { id: "adrenaline-orb", bp: TIER.common, category: "buffer" },
  { id: "blunder-policy", bp: TIER.mid, category: "buffer" },
  { id: "room-service", bp: TIER.common, category: "buffer" },
  { id: "air-balloon", bp: TIER.common, category: "buffer" },
  { id: "utility-umbrella", bp: TIER.common, category: "buffer" },
  { id: "shed-shell", bp: TIER.common, category: "buffer" },
  { id: "protective-pads", bp: TIER.common, category: "buffer" },

  // Weather rocks (extend duration)
  { id: "damp-rock", bp: TIER.mid, category: "field-rock" },
  { id: "heat-rock", bp: TIER.mid, category: "field-rock" },
  { id: "smooth-rock", bp: TIER.mid, category: "field-rock" },
  { id: "icy-rock", bp: TIER.mid, category: "field-rock" },
  { id: "light-clay", bp: TIER.mid, category: "field-rock" },
  { id: "terrain-extender", bp: TIER.mid, category: "field-rock" },

  // Terrain seeds
  { id: "electric-seed", bp: TIER.common, category: "terrain-seed" },
  { id: "grassy-seed", bp: TIER.common, category: "terrain-seed" },
  { id: "psychic-seed", bp: TIER.common, category: "terrain-seed" },
  { id: "misty-seed", bp: TIER.common, category: "terrain-seed" },

  // Effort-training (Power items)
  { id: "macho-brace", bp: TIER.mid, category: "training" },
  { id: "power-anklet", bp: TIER.mid, category: "training" },
  { id: "power-band", bp: TIER.mid, category: "training" },
  { id: "power-belt", bp: TIER.mid, category: "training" },
  { id: "power-bracer", bp: TIER.mid, category: "training" },
  { id: "power-lens", bp: TIER.mid, category: "training" },
  { id: "power-weight", bp: TIER.mid, category: "training" },

  // Nature mints (canon: 50 BP each in Sw/Sh)
  { id: "adamant-mint", bp: TIER.high, category: "nature-mint" },
  { id: "bold-mint", bp: TIER.high, category: "nature-mint" },
  { id: "brave-mint", bp: TIER.high, category: "nature-mint" },
  { id: "calm-mint", bp: TIER.high, category: "nature-mint" },
  { id: "careful-mint", bp: TIER.high, category: "nature-mint" },
  { id: "gentle-mint", bp: TIER.high, category: "nature-mint" },
  { id: "hasty-mint", bp: TIER.high, category: "nature-mint" },
  { id: "impish-mint", bp: TIER.high, category: "nature-mint" },
  { id: "jolly-mint", bp: TIER.high, category: "nature-mint" },
  { id: "lax-mint", bp: TIER.high, category: "nature-mint" },
  { id: "lonely-mint", bp: TIER.high, category: "nature-mint" },
  { id: "mild-mint", bp: TIER.high, category: "nature-mint" },
  { id: "modest-mint", bp: TIER.high, category: "nature-mint" },
  { id: "naive-mint", bp: TIER.high, category: "nature-mint" },
  { id: "naughty-mint", bp: TIER.high, category: "nature-mint" },
  { id: "quiet-mint", bp: TIER.high, category: "nature-mint" },
  { id: "rash-mint", bp: TIER.high, category: "nature-mint" },
  { id: "relaxed-mint", bp: TIER.high, category: "nature-mint" },
  { id: "sassy-mint", bp: TIER.high, category: "nature-mint" },
  { id: "serious-mint", bp: TIER.high, category: "nature-mint" },
  { id: "timid-mint", bp: TIER.high, category: "nature-mint" },

  // Rare transforms / abilities
  { id: "ability-capsule", bp: TIER.rare, category: "rare" },
  { id: "ability-patch", bp: TIER.legend, category: "rare" },
  { id: "sacred-ash", bp: TIER.legend, category: "rare" },
];

let cache: BpShopEntry[] | null = null;

/**
 * Build the BP shop catalog. Items missing from items.json (e.g. before
 * sync) are silently dropped so the shop remains stable.
 */
export function getBpShopEntries(): BpShopEntry[] {
  if (cache) return cache;
  const out: BpShopEntry[] = [];
  for (const spec of BP_ITEM_SPECS) {
    const item = getItemById(spec.id);
    if (!item) continue;
    out.push({ id: spec.id, name: item.name, bp: spec.bp, category: spec.category });
  }
  cache = out;
  return out;
}

export function findBpShopEntry(id: string): BpShopEntry | undefined {
  return getBpShopEntries().find((entry) => entry.id === id);
}

// Test-only escape hatch: the catalog is cached for production lookups
// but tests may need to reset state when getItemById's cache is cleared.
export function __resetBpShopCacheForTests(): void {
  cache = null;
}
