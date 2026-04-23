import type { OwnedPokemon } from "../../../../shared/types.js";
import type { PvpPokemon, PvpTransformForm } from "../../../../shared/pvp-types.js";
import { getMegaVariantForItem, checkPrimalReversion, applyGmaxHp } from "../game/battle-transformations.js";
import { buildStatsForPokemon } from "../game/pokemon-stats.js";
import { getVariants } from "../game/data-loader.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";

/**
 * Default Tera Type for a pokemon at battle start.
 * Ogerpon masks and Terapagos-Stellar are forced to specific types.
 * All other pokemon default to their first original type.
 */
export function getDefaultTeraType(species: string, types: string[]): string {
  if (species === "ogerpon") return "grass";
  if (species === "ogerpon-wellspring-mask") return "water";
  if (species === "ogerpon-hearthflame-mask") return "fire";
  if (species === "ogerpon-cornerstone-mask") return "rock";
  if (species === "terapagos-stellar") return "stellar";
  return types[0] ?? "normal";
}

export interface PvpPartyBuildResult {
  party: PvpPokemon[];
  hasKeyStone: boolean;
  hasDynamaxBand: boolean;
}

export interface PvpPartyBuildOptions {
  /**
   * If set, the pokemon is only included when `predicate(pokemon)` returns
   * true. Default: `p => p.hp > 0`.
   */
  predicate?: (p: OwnedPokemon) => boolean;
  /**
   * Level cap for every pokemon. Default: 50 (matches canon VGC cap).
   */
  levelCap?: number;
  /**
   * If true, enforce Species Clause within the built party. Default true.
   */
  enforceSpeciesClause?: boolean;
}

/**
 * Build a PvP-ready party from a pokemon list. This is the single source of
 * truth for OwnedPokemon → PvpPokemon conversion (mega/gmax/primal/ultra
 * pre-computation, Tera defaults, etc.).
 *
 * Caller controls pokemon selection via `orderedPokemon`; no filtering is
 * done here beyond the optional predicate.
 */
export function buildPvpPartyFromPokemon(
  orderedPokemon: OwnedPokemon[],
  inventory: Record<string, number> | undefined,
  options: PvpPartyBuildOptions = {},
): PvpPartyBuildResult {
  const predicate = options.predicate ?? ((p) => p.hp > 0);
  const levelCap = options.levelCap ?? 50;
  const enforceClause = options.enforceSpeciesClause ?? true;

  let pool = orderedPokemon.filter(predicate);
  if (enforceClause) {
    const seen = new Set<string>();
    pool = pool.filter((p) => {
      if (seen.has(p.species)) return false;
      seen.add(p.species);
      return true;
    });
  }

  const inv = inventory ?? {};
  const hasKeyStone = (inv["key-stone"] ?? 0) > 0;
  const hasDynamaxBand = (inv["dynamax-band"] ?? 0) > 0;

  const party = pool.map((p) => {
    const level = Math.min(p.level, levelCap);
    const effectiveTypes = getEffectiveTypes(p.species, p.variantId ?? null, null);
    const base: PvpPokemon = {
      uid: p.uid, species: p.species, variantId: p.variantId,
      level,
      hp: p.maxHp, maxHp: p.maxHp,
      stats: { ...p.stats }, moves: p.moves.map((m) => ({ ...m, pp: m.maxPp })),
      statusCondition: null, nature: p.nature, abilityId: p.abilityId, isShiny: p.isShiny,
      heldItem: p.heldItem ?? null,
      hasGigantamaxFactor: p.hasGigantamaxFactor ?? false,
      megaForm: null,
      gmaxForm: null,
      primalForm: null,
      gender: p.gender ?? null,
      teraType: p.teraType ?? getDefaultTeraType(p.species, effectiveTypes),
      originalTypes: effectiveTypes,
      stellarTypesUsed: [],
      rageFistHits: 0,
    };

    const pokemonForStats = { species: p.species, level, nature: p.nature, variantId: p.variantId, ivs: p.ivs };

    // Mega form pre-computation
    if (p.species === "rayquaza") {
      const hasDragonAscent = p.moves.some((m) => m.id === "dragon-ascent");
      if (hasDragonAscent) {
        try {
          const megaStats = buildStatsForPokemon(pokemonForStats, "rayquaza-mega");
          base.megaForm = { variantId: "rayquaza-mega", maxHp: megaStats.maxHp, stats: megaStats.stats };
        } catch { /* variant data unavailable */ }
      }
    } else if (p.heldItem) {
      const megaVariantId = getMegaVariantForItem(p.species, p.heldItem);
      if (megaVariantId) {
        try {
          const megaStats = buildStatsForPokemon(pokemonForStats, megaVariantId);
          base.megaForm = { variantId: megaVariantId, maxHp: megaStats.maxHp, stats: megaStats.stats };
        } catch { /* variant data unavailable */ }
      }
    }

    // Gmax form pre-computation
    if (p.hasGigantamaxFactor) {
      const variantPrefix = p.variantId ?? p.species;
      const gmaxVariantId = `${variantPrefix}-gmax`;
      const variant = getVariants().find((v) => v.id === gmaxVariantId && v.category === "gigantamax");
      if (variant) {
        try {
          const gmaxStats = buildStatsForPokemon(pokemonForStats, gmaxVariantId);
          const boosted = applyGmaxHp(gmaxStats.maxHp, gmaxStats.maxHp);
          base.gmaxForm = { variantId: gmaxVariantId, maxHp: boosted.maxHp, stats: gmaxStats.stats };
        } catch { /* variant data unavailable */ }
      }
    }

    // Primal form pre-computation
    const primalVariantId = checkPrimalReversion(p);
    if (primalVariantId) {
      try {
        const primalStats = buildStatsForPokemon(pokemonForStats, primalVariantId);
        base.primalForm = { variantId: primalVariantId, maxHp: primalStats.maxHp, stats: primalStats.stats };
      } catch { /* variant data unavailable */ }
    }

    // Ultra Burst form
    const isUltraBurstEligible =
      (p.species === "necrozma-dusk" || p.species === "necrozma-dawn")
      && p.heldItem === "ultra-necrozium-z";
    if (isUltraBurstEligible) {
      try {
        const ultraStats = buildStatsForPokemon(pokemonForStats, "necrozma-ultra");
        base.ultraForm = { variantId: "necrozma-ultra", maxHp: ultraStats.maxHp, stats: ultraStats.stats };
      } catch { /* variant data unavailable */ }
    }

    return base;
  });

  return { party, hasKeyStone, hasDynamaxBand };
}

/**
 * Convenience helper for users who want the canonical "active party"
 * PvP conversion: read user.party (UIDs), filter alive, enforce species
 * clause, build PvP forms at level cap 50.
 */
export function userPartyToPvp(
  user: { pokemon: OwnedPokemon[]; party: string[]; inventory?: Record<string, number> },
): PvpPartyBuildResult {
  const ordered = user.party
    .map((uid) => user.pokemon.find((p) => p.uid === uid))
    .filter((p): p is OwnedPokemon => p != null);
  return buildPvpPartyFromPokemon(ordered, user.inventory);
}

/**
 * Deep-copy a PvP pokemon. Useful when generating AI parties from a mirror
 * of the user's team (each side needs an independent PvpPokemon instance).
 */
export function deepCopyPvpPokemon(p: PvpPokemon): PvpPokemon {
  const cloneForm = (f: PvpTransformForm | null | undefined): PvpTransformForm | null =>
    f ? { variantId: f.variantId, maxHp: f.maxHp, stats: { ...f.stats } } : null;
  return {
    ...p,
    stats: { ...p.stats },
    moves: p.moves.map((m) => ({ ...m })),
    megaForm: cloneForm(p.megaForm),
    gmaxForm: cloneForm(p.gmaxForm),
    primalForm: cloneForm(p.primalForm),
    ultraForm: cloneForm(p.ultraForm),
  };
}
