import crypto from "node:crypto";
import { getSpeciesByName, getMoves, getAllSpeciesList, getNatures } from "./data-loader.js";
import type { OwnedPokemon, WildPokemon, PokemonMove, SpeciesData } from "../../../../shared/types.js";
import { resolvePokemonGender } from "./pokemon-gender.js";
import { buildStats } from "./pokemon-stats.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";

function buildMoves(species: SpeciesData, level: number): PokemonMove[] {
  const allMoves = getMoves();
  const moveMap = new Map(allMoves.map((move) => [move.id, move]));
  const levelUpLearnset = species.learnset.levelUp;

  const learnableMoves: string[] = [];
  const sortedLevels = Object.keys(levelUpLearnset)
    .map(Number)
    .sort((left, right) => left - right);

  for (const moveLevel of sortedLevels) {
    if (moveLevel > level) {
      continue;
    }

    for (const moveId of levelUpLearnset[String(moveLevel)]) {
      const duplicateIndex = learnableMoves.indexOf(moveId);
      if (duplicateIndex !== -1) {
        learnableMoves.splice(duplicateIndex, 1);
      }
      learnableMoves.push(moveId);
    }
  }

  const selectedIds = learnableMoves.slice(-4);
  return selectedIds.map((id) => {
    const moveData = moveMap.get(id);
    const pp = moveData?.pp ?? 10;
    return { id, pp, maxPp: pp };
  });
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

const ALL_TERA_TYPES = [
  "normal", "fire", "water", "electric", "grass", "ice",
  "fighting", "poison", "ground", "flying", "psychic", "bug",
  "rock", "ghost", "dragon", "dark", "steel", "fairy",
];

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
  const { baseSpecies, variantId, speciesData } = resolveSpeciesOrVariant(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId);
  const moves = buildMoves(speciesData, level);

  return {
    uid: crypto.randomUUID(),
    species: baseSpecies,
    variantId,
    nickname: null,
    level,
    exp: 0,
    hp: maxHp,
    maxHp,
    stats,
    moves,
    caughtAt: new Date().toISOString(),
    gender: resolvePokemonGender(speciesData.genderRate, Math.random()),
    friendship: speciesData.baseHappiness ?? 70,
    heldItem: null,
    abilityId: speciesData.abilities?.normal[0] ?? null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature,
    isShiny: Math.random() < (1 / 4096),
    teraType: speciesData.types?.[0] ?? "normal",
  };
}

export function createWildPokemon(species: string, level: number): WildPokemon {
  const { baseSpecies, variantId, speciesData } = resolveSpeciesOrVariant(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId);
  const moves = buildMoves(speciesData, level);
  const ability = pickWildAbility(speciesData.abilities);
  const teraType = pickWildTeraType(speciesData.types);

  return {
    species: baseSpecies,
    variantId: variantId ?? null,
    level,
    hp: maxHp,
    maxHp,
    stats,
    moves,
    nature,
    gender: resolvePokemonGender(speciesData.genderRate, Math.random()),
    ability,
    isShiny: Math.random() < (1 / 4096),
    teraType,
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
  };
}

export function getAllSpecies(): Array<{ id: number; species: string; name: string }> {
  return getAllSpeciesList();
}
