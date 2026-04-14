import { readFileSync } from "node:fs";
import type { OwnedPokemon, BattleState, PokemonStats } from "../../../../shared/types.js";
import { getVariants } from "./data-loader.js";
import { buildStatsForPokemon } from "./pokemon-stats.js";
import { projectPath } from "../paths.js";

export type TransformationType = "mega" | "gigantamax" | "primal";

// ── Mega stone → variant ID mapping ──

/**
 * Derive the expected mega stone name from a variant ID.
 * Examples:
 *   "charizard-mega-x" → "charizardite-x"
 *   "venusaur-mega"    → "venusaurite"
 *   "mewtwo-mega-y"    → "mewtwonite-y"
 */
function variantIdToMegaStone(variantId: string): string {
  // e.g. "charizard-mega-x" → baseSpecies="charizard", suffix="x"
  const parts = variantId.split("-mega");
  const species = parts[0]; // e.g. "charizard"
  const suffix = parts[1]; // e.g. "-x" or "" (empty for non-x/y)

  // Build stone name: species + "ite" + suffix
  // Special cases for certain species names
  const stoneBase = species + "ite";

  if (suffix && suffix.startsWith("-")) {
    // e.g. charizard + "ite" + "-x" → "charizardite-x"
    return stoneBase + suffix;
  }

  return stoneBase;
}

/**
 * Get the mega variant ID for a given species + held item combo.
 * Returns null if no matching mega variant exists.
 */
export function getMegaVariantForItem(species: string, heldItem: string): string | null {
  const megaVariants = getVariants().filter(
    (v) => v.baseSpecies === species && v.category === "mega",
  );

  for (const variant of megaVariants) {
    const expectedStone = variantIdToMegaStone(variant.id);
    if (expectedStone === heldItem) {
      return variant.id;
    }
  }

  return null;
}

// ── Primal reversion ──

/**
 * Check if a pokemon should trigger primal reversion.
 * Returns the primal variant ID or null.
 */
export function checkPrimalReversion(pokemon: OwnedPokemon): string | null {
  if (pokemon.species === "groudon" && pokemon.heldItem === "red-orb") {
    return "groudon-primal";
  }
  if (pokemon.species === "kyogre" && pokemon.heldItem === "blue-orb") {
    return "kyogre-primal";
  }
  return null;
}

// ── Mega evolution checks ──

/**
 * Check if mega evolution is available for the given pokemon in the current battle.
 */
export function canMegaEvolve(
  pokemon: OwnedPokemon,
  battle: BattleState,
  userInventory: Record<string, number>,
): { ok: boolean; variantId?: string; error?: string } {
  // Already used a transformation this battle
  if (battle.transformationUsed) {
    return { ok: false, error: "이번 배틀에서 이미 변환을 사용했습니다" };
  }

  // Already transformed
  if (battle.transformationType) {
    return { ok: false, error: "이미 변환 중입니다" };
  }

  // Rayquaza special case: no mega stone needed, needs dragon-ascent
  if (pokemon.species === "rayquaza") {
    const hasDragonAscent = pokemon.moves.some((m) => m.id === "dragon-ascent");
    if (!hasDragonAscent) {
      return { ok: false, error: "레쿠쟈는 화룡점정 기술이 필요합니다" };
    }
    return { ok: true, variantId: "rayquaza-mega" };
  }

  // Need a key stone
  if (!userInventory["key-stone"] || userInventory["key-stone"] <= 0) {
    return { ok: false, error: "키스톤이 필요합니다" };
  }

  // Need a mega stone held item
  if (!pokemon.heldItem) {
    return { ok: false, error: "메가스톤을 지니고 있지 않습니다" };
  }

  const variantId = getMegaVariantForItem(pokemon.species, pokemon.heldItem);
  if (!variantId) {
    return { ok: false, error: "올바른 메가스톤이 아닙니다" };
  }

  return { ok: true, variantId };
}

// ── Gigantamax checks ──

/**
 * Check if gigantamax is available for the given pokemon in the current battle.
 */
export function canGigantamax(
  pokemon: OwnedPokemon,
  battle: BattleState,
  userInventory: Record<string, number>,
): { ok: boolean; variantId?: string; error?: string } {
  // Already used a transformation this battle
  if (battle.transformationUsed) {
    return { ok: false, error: "이번 배틀에서 이미 변환을 사용했습니다" };
  }

  // Already transformed
  if (battle.transformationType) {
    return { ok: false, error: "이미 변환 중입니다" };
  }

  // Need gigantamax factor
  if (!pokemon.hasGigantamaxFactor) {
    return { ok: false, error: "기가맥스 팩터가 없습니다" };
  }

  // Need dynamax band
  if (!userInventory["dynamax-band"] || userInventory["dynamax-band"] <= 0) {
    return { ok: false, error: "다이맥스밴드가 필요합니다" };
  }

  // Find the gmax variant for this species
  const baseSpecies = pokemon.species;
  // Handle variant-based gmax (e.g. urshifu-rapid-strike → urshifu-rapid-strike-gmax)
  const variantPrefix = pokemon.variantId ?? baseSpecies;
  const gmaxVariantId = `${variantPrefix}-gmax`;

  const variant = getVariants().find(
    (v) => v.id === gmaxVariantId && v.category === "gigantamax",
  );

  if (!variant) {
    return { ok: false, error: "기가맥스 폼이 존재하지 않습니다" };
  }

  return { ok: true, variantId: gmaxVariantId };
}

// ── Stats transformation ──

/**
 * Recalculate stats using a variant's baseStatsOverride.
 */
export function getTransformedStats(
  pokemon: OwnedPokemon,
  variantId: string,
): { maxHp: number; stats: PokemonStats } {
  try {
    return buildStatsForPokemon(pokemon, variantId);
  } catch {
    return { maxHp: pokemon.maxHp, stats: { ...pokemon.stats } };
  }
}

// ── Gigantamax HP ──

/**
 * Apply gigantamax HP boost (1.5x).
 */
export function applyGmaxHp(hp: number, maxHp: number): { hp: number; maxHp: number } {
  const newMaxHp = Math.ceil(maxHp * 1.5);
  const newHp = Math.ceil(hp * 1.5);
  return { hp: newHp, maxHp: newMaxHp };
}

/**
 * Revert gigantamax HP (proportional).
 */
export function revertGmaxHp(
  hp: number,
  maxHp: number,
  originalMaxHp: number,
): { hp: number; maxHp: number } {
  const newHp = Math.floor((hp * originalMaxHp) / maxHp);
  return { hp: newHp, maxHp: originalMaxHp };
}

// ── G-Max exclusive moves ──

type GmaxMoveEntry = { type: string; move: string };
type GmaxMoveMap = Record<string, GmaxMoveEntry>;

let gmaxMoveCache: GmaxMoveMap | null = null;

function getGmaxMoveMap(): GmaxMoveMap {
  if (!gmaxMoveCache) {
    try {
      gmaxMoveCache = JSON.parse(
        readFileSync(projectPath("data/pokemon/gmax-moves.json"), "utf-8"),
      ) as GmaxMoveMap;
    } catch {
      gmaxMoveCache = {};
    }
  }
  return gmaxMoveCache;
}

/**
 * Get the G-Max exclusive move for a given species + move type.
 *
 * When a Gigantamaxed Pokemon uses a damaging move whose type matches its
 * exclusive G-Max move type, this function returns the G-Max move ID.
 *
 * The `species` parameter should be the base species name (e.g. "charizard"),
 * or the variant prefix for variant-based gmax forms (e.g. "urshifu-rapid-strike").
 *
 * Returns null if there is no matching G-Max move.
 */
export function getGmaxMove(species: string, moveType: string): string | null {
  const map = getGmaxMoveMap();
  const entry = map[species];
  if (!entry) return null;
  if (entry.type !== moveType) return null;
  return entry.move;
}
