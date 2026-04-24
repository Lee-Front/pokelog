import crypto from "node:crypto";
import { getSpeciesByName, getMoves, getAllSpeciesList, getNatures, getMoveById } from "./data-loader.js";
import type {
  IndividualValues,
  OwnedPokemon,
  WildPokemon,
  PokemonMove,
  SpeciesData,
} from "../../../../shared/types.js";
import { ALL_TERA_TYPES } from "../../../../shared/constants.js";
import { resolvePokemonGender } from "./pokemon-gender.js";
import { buildStats } from "./pokemon-stats.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";

/**
 * Roll a fresh set of Individual Values. Each stat independently rolls a
 * uniform integer in [0, 31], matching canon Gen 3+ wild-pokemon IV
 * generation.
 */
export function rollIvs(): IndividualValues {
  return {
    hp: Math.floor(Math.random() * 32),
    attack: Math.floor(Math.random() * 32),
    defense: Math.floor(Math.random() * 32),
    spAttack: Math.floor(Math.random() * 32),
    spDefense: Math.floor(Math.random() * 32),
    speed: Math.floor(Math.random() * 32),
  };
}

/**
 * Strategy for selecting which moves a pokemon should know from a
 * levelUp learnset.
 *
 * - `latest`   – take the 4 most-recently-learnt moves (canonical default
 *                for freshly-created NPC / wild encounters)
 * - `strongest`– rank by move power (status moves rank 0) and take top 4
 *                (used by the Battle Tower "competitive" AI tier)
 * - `random`   – shuffle and pick N (for generic randomised builds)
 */
export type MoveSelectionStrategy = "latest" | "strongest" | "random";

/**
 * Build a list of move IDs the pokemon should know at the given level
 * from a levelUp learnset, applying a selection strategy.
 */
export function selectMoves(
  learnsetLevelUp: Record<string, string[]>,
  level: number,
  strategy: MoveSelectionStrategy = "latest",
  count = 4,
): string[] {
  const learnableMoves: string[] = [];
  const sortedLevels = Object.keys(learnsetLevelUp)
    .map(Number)
    .sort((left, right) => left - right);

  for (const moveLevel of sortedLevels) {
    if (moveLevel > level) {
      continue;
    }
    for (const moveId of learnsetLevelUp[String(moveLevel)]) {
      const duplicateIndex = learnableMoves.indexOf(moveId);
      if (duplicateIndex !== -1) {
        learnableMoves.splice(duplicateIndex, 1);
      }
      learnableMoves.push(moveId);
    }
  }

  if (strategy === "strongest") {
    const unique = Array.from(new Set(learnableMoves));
    const scored = unique.map((id) => {
      const m = getMoveById(id);
      return { id, power: m?.power ?? 0 };
    });
    scored.sort((a, b) => b.power - a.power);
    return scored.slice(0, count).map((s) => s.id);
  }

  if (strategy === "random") {
    const unique = Array.from(new Set(learnableMoves));
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }
    return unique.slice(0, count);
  }

  // Default: "latest"
  return learnableMoves.slice(-count);
}

function buildMoves(species: SpeciesData, level: number): PokemonMove[] {
  const allMoves = getMoves();
  const moveMap = new Map(allMoves.map((move) => [move.id, move]));
  const selectedIds = selectMoves(species.learnset.levelUp, level, "latest", 4);
  return selectedIds.map((id) => {
    const moveData = moveMap.get(id);
    const pp = moveData?.pp ?? 10;
    return { id, pp, maxPp: pp };
  });
}

/**
 * Common core for building a freshly-generated pokemon (wild or owned).
 * Centralises IV rolling, nature, stat computation and moveset.
 */
function buildBasePokemon(species: string, level: number): {
  baseSpecies: string;
  variantId: string | null;
  speciesData: SpeciesData;
  nature: string;
  ivs: IndividualValues;
  maxHp: number;
  stats: import("../../../../shared/types.js").PokemonStats;
  moves: PokemonMove[];
  isShiny: boolean;
  gender: ReturnType<typeof resolvePokemonGender>;
} {
  const { baseSpecies, variantId, speciesData } = resolveSpeciesOrVariant(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const ivs = rollIvs();
  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId, ivs);
  const moves = buildMoves(speciesData, level);
  const isShiny = Math.random() < (1 / 4096);
  const gender: ReturnType<typeof resolvePokemonGender> = resolvePokemonGender(
    speciesData.genderRate,
    Math.random(),
  );

  return {
    baseSpecies,
    variantId: variantId ?? null,
    speciesData,
    nature,
    ivs,
    maxHp,
    stats,
    moves,
    isShiny,
    gender,
  };
}

function pickRandomNature(): string {
  const natures = getNatures();
  return natures.length > 0
    ? natures[Math.floor(Math.random() * natures.length)].id
    : "hardy";
}

/**
 * Wild hidden-ability chance. Canon behaviour: normal encounters never roll
 * a hidden ability, but rare spawns (Mass Outbreak / Friend Safari / 4★+
 * Tera Raids) can. We approximate with a flat 5% per spawn.
 */
const WILD_HIDDEN_ABILITY_CHANCE = 0.05;

export function pickWildAbility(
  abilities: { normal: string[]; hidden?: string } | undefined,
): string | undefined {
  if (!abilities) return undefined;
  if (abilities.hidden && Math.random() < WILD_HIDDEN_ABILITY_CHANCE) {
    return abilities.hidden;
  }
  const normal = abilities.normal ?? [];
  if (normal.length === 0) return abilities.hidden ?? undefined;
  return normal[Math.floor(Math.random() * normal.length)];
}

/**
 * Wild tera-type selection. Defaults to the species primary type (canonical
 * for random encounters); a small chance produces a "mismatched" tera type
 * simulating 5★/6★ Tera Raid spawns.
 */
const WILD_RANDOM_TERA_CHANCE = 0.05;

export function pickWildTeraType(speciesTypes: string[] | undefined): string {
  const primary = speciesTypes?.[0] ?? "normal";
  if (Math.random() < WILD_RANDOM_TERA_CHANCE) {
    return ALL_TERA_TYPES[Math.floor(Math.random() * ALL_TERA_TYPES.length)];
  }
  return primary;
}

export { buildStats } from "./pokemon-stats.js";

export function createPokemon(species: string, level: number): OwnedPokemon {
  const base = buildBasePokemon(species, level);

  return {
    uid: crypto.randomUUID(),
    species: base.baseSpecies,
    variantId: base.variantId,
    nickname: null,
    level,
    exp: 0,
    hp: base.maxHp,
    maxHp: base.maxHp,
    stats: base.stats,
    moves: base.moves,
    caughtAt: new Date().toISOString(),
    gender: base.gender,
    friendship: base.speciesData.baseHappiness ?? 70,
    heldItem: null,
    abilityId: base.speciesData.abilities?.normal[0] ?? null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: base.nature,
    isShiny: base.isShiny,
    teraType: base.speciesData.types?.[0] ?? "normal",
    ivs: base.ivs,
  };
}

export function createWildPokemon(species: string, level: number): WildPokemon {
  const base = buildBasePokemon(species, level);
  const ability = pickWildAbility(base.speciesData.abilities);
  const teraType = pickWildTeraType(base.speciesData.types);

  return {
    species: base.baseSpecies,
    variantId: base.variantId,
    level,
    hp: base.maxHp,
    maxHp: base.maxHp,
    stats: base.stats,
    moves: base.moves,
    nature: base.nature,
    gender: base.gender,
    ability,
    isShiny: base.isShiny,
    teraType,
    ivs: base.ivs,
  };
}

export function wildPokemonToOwned(wild: WildPokemon): OwnedPokemon {
  const speciesData = getSpeciesByName(wild.species);
  return {
    uid: crypto.randomUUID(),
    species: wild.species,
    variantId: wild.variantId ?? null,
    nickname: null,
    level: wild.level,
    exp: 0,
    hp: wild.hp,
    maxHp: wild.maxHp,
    stats: { ...wild.stats },
    moves: wild.moves.map((move) => ({ ...move })),
    caughtAt: new Date().toISOString(),
    gender: wild.gender ?? null,
    friendship: speciesData?.baseHappiness ?? 70,
    heldItem: null,
    abilityId: wild.ability ?? speciesData?.abilities?.normal[0] ?? null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: wild.nature ?? "hardy",
    isShiny: wild.isShiny ?? false,
    teraType: wild.teraType ?? speciesData?.types?.[0] ?? "normal",
    ivs: wild.ivs ? { ...wild.ivs } : undefined,
  };
}

export function getAllSpecies(): Array<{ id: number; species: string; name: string }> {
  return getAllSpeciesList();
}
