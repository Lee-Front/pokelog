import type { OwnedPokemon, SpeciesData, PokemonMove } from "../../../../shared/types.js";
import { createPokemon } from "./pokemon-factory.js";
import { getSpecies, getSpeciesByName, getMoveById } from "./data-loader.js";

/**
 * Canon Battle Tower legendary pool (hardcoded; species.json isLegendary
 * flags are present but we want to control which legendaries can appear).
 */
const LEGENDARY_POOL = [
  "articuno", "zapdos", "moltres", "mewtwo", "mew",
  "raikou", "entei", "suicune", "lugia", "ho-oh", "celebi",
  "regirock", "regice", "registeel", "latias", "latios", "kyogre", "groudon", "rayquaza", "jirachi", "deoxys",
  "uxie", "mesprit", "azelf", "dialga", "palkia", "heatran", "regigigas", "giratina", "cresselia", "darkrai", "arceus",
  "cobalion", "terrakion", "virizion", "tornadus", "thundurus", "landorus", "reshiram", "zekrom", "kyurem", "keldeo", "meloetta",
  "xerneas", "yveltal", "zygarde", "diancie", "hoopa", "volcanion",
  "tapu-koko", "tapu-lele", "tapu-bulu", "tapu-fini", "solgaleo", "lunala", "necrozma",
  "zacian", "zamazenta", "eternatus", "calyrex", "glastrier", "spectrier",
  "koraidon", "miraidon", "ogerpon", "terapagos",
];

let cachedGeneralPool: string[] | null = null;

/**
 * Build the pool of "battle-viable" non-legendary species with BST >= 400
 * and a non-empty levelUp learnset. Cached for subsequent calls.
 */
export function getGeneralPool(): string[] {
  if (cachedGeneralPool) return cachedGeneralPool;
  const all = getSpecies();
  cachedGeneralPool = all
    .filter((s) => !s.isBaby && !s.isLegendary && !s.isMythical)
    .filter((s) => {
      const bst = s.baseStats.hp + s.baseStats.attack + s.baseStats.defense
        + s.baseStats.spAttack + s.baseStats.spDefense + s.baseStats.speed;
      return bst >= 400;
    })
    .filter((s) => Object.keys(s.learnset?.levelUp ?? {}).length > 0)
    .map((s) => s.species);
  return cachedGeneralPool;
}

export interface TowerStageConfig {
  level: number;
  useLegendary: boolean;
  heldItems: boolean;
  competitive: boolean;
}

export function getStageConfig(stage: number): TowerStageConfig {
  if (stage >= 100) return { level: 60, useLegendary: true, heldItems: true, competitive: true };
  if (stage >= 50) return { level: 55, useLegendary: true, heldItems: true, competitive: true };
  if (stage >= 20) return { level: 50, useLegendary: false, heldItems: true, competitive: true };
  if (stage >= 10) return { level: 50, useLegendary: false, heldItems: true, competitive: true };
  if (stage >= 5) return { level: 45, useLegendary: false, heldItems: true, competitive: false };
  return { level: 40, useLegendary: false, heldItems: false, competitive: false };
}

const COMPETITIVE_ITEMS = [
  "leftovers", "life-orb", "choice-band", "choice-specs", "choice-scarf",
  "focus-sash", "assault-vest",
];

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildMovesForStage(species: SpeciesData, level: number, competitive: boolean): PokemonMove[] {
  const levelUp = species.learnset?.levelUp ?? {};
  const available: string[] = [];
  const learnLevels = Object.keys(levelUp).map(Number).sort((a, b) => a - b);
  for (const lvl of learnLevels) {
    if (lvl > level) continue;
    for (const moveId of levelUp[String(lvl)]) {
      const dupIdx = available.indexOf(moveId);
      if (dupIdx !== -1) available.splice(dupIdx, 1);
      available.push(moveId);
    }
  }
  const unique = Array.from(new Set(available));
  let selected: string[];
  if (competitive) {
    // Rank by power (status moves rank 0). Take top 4.
    const scored = unique.map((id) => {
      const m = getMoveById(id);
      return { id, power: m?.power ?? 0 };
    });
    scored.sort((a, b) => b.power - a.power);
    selected = scored.slice(0, 4).map((s) => s.id);
  } else {
    // Recent 4 (last learnt at this level)
    selected = unique.slice(-4);
  }
  if (selected.length === 0) selected = ["tackle"];
  return selected.map((id) => {
    const m = getMoveById(id);
    const pp = m?.pp ?? 10;
    return { id, pp, maxPp: pp };
  });
}

/**
 * Generate a 3-mon AI party for the given tower stage. Enforces Species
 * Clause within the AI team. Held items and move selection follow stage
 * config.
 */
export function generateTowerParty(stage: number): OwnedPokemon[] {
  const config = getStageConfig(stage);
  const legendaryWeighted = config.useLegendary ? shuffle(LEGENDARY_POOL) : [];
  const generalWeighted = shuffle(getGeneralPool());
  // Legendaries first when allowed, then fall through to general pool for
  // variety / to satisfy the Species Clause if legendary roster exhausts.
  const ordered = config.useLegendary
    ? [...legendaryWeighted.slice(0, 2), ...generalWeighted]
    : generalWeighted;

  const chosen: string[] = [];
  for (const s of ordered) {
    if (chosen.length >= 3) break;
    if (chosen.includes(s)) continue;
    // Skip species we cannot construct (missing data / zero learnset).
    const sp = getSpeciesByName(s);
    if (!sp) continue;
    if (Object.keys(sp.learnset?.levelUp ?? {}).length === 0) continue;
    chosen.push(s);
  }

  const party: OwnedPokemon[] = [];
  for (const species of chosen) {
    let poke: OwnedPokemon;
    try {
      poke = createPokemon(species, config.level);
    } catch {
      continue;
    }
    const sp = getSpeciesByName(species);
    if (sp) {
      poke.teraType = sp.types?.[0] ?? "normal";
      poke.moves = buildMovesForStage(sp, config.level, config.competitive);
    }
    if (config.heldItems) {
      poke.heldItem = COMPETITIVE_ITEMS[Math.floor(Math.random() * COMPETITIVE_ITEMS.length)];
    }
    party.push(poke);
  }

  return party;
}
