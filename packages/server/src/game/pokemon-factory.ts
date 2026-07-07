import crypto from "node:crypto";
import { getSpeciesByName, getMoves, getAllSpeciesList, getNatures } from "./data-loader.js";
import type { OwnedPokemon, WildPokemon, PokemonMove, SpeciesData } from "../../../../shared/types.js";
import { resolvePokemonGender } from "./pokemon-gender.js";
import { buildStats } from "./pokemon-stats.js";
import { resolveSpeciesOrVariant } from "./pokemon-state.js";
import { getShinyRate } from "./shiny.js";
import { getExpForLevelInGroup } from "./growth.js";
import { randomIvs } from "./ivs.js";
import { emptyEvs } from "./evs.js";

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
 * 생성 시 일반 특성(abilities.normal) 중 하나를 균등 확률로 고른다. 숨은 특성(hidden)은
 * 생성 시 뽑지 않는다(본가식 — 숨은 특성은 특성패치로만 도달). 항목이 0개면 null,
 * 1개면 그 값, 2개 이상이면 무작위 1개를 반환한다.
 */
export function pickAbilityId(speciesData: SpeciesData): string | null {
  const normal = speciesData.abilities?.normal;
  if (!normal || normal.length === 0) {
    return null;
  }
  return normal[Math.floor(Math.random() * normal.length)];
}

export { buildStats } from "./pokemon-stats.js";

export function createPokemon(species: string, level: number): OwnedPokemon {
  const { baseSpecies, variantId, speciesData } = resolveSpeciesOrVariant(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const ivs = randomIvs();
  const evs = emptyEvs();
  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId, ivs, evs);
  const moves = buildMoves(speciesData, level);

  return {
    uid: crypto.randomUUID(),
    species: baseSpecies,
    variantId,
    nickname: null,
    level,
    // 레벨에 맞는 누적 경험치로 초기화(본가식, 종별 성장곡선). 0으로 두면 레벨>1 개체가
    // 다음 레벨 임계치에 한참 못 미쳐 사실상 레벨이 오르지 않는다.
    exp: getExpForLevelInGroup(speciesData.expGroup, level),
    hp: maxHp,
    maxHp,
    stats,
    ivs,
    evs,
    moves,
    caughtAt: new Date().toISOString(),
    gender: resolvePokemonGender(speciesData.genderRate, Math.random()),
    friendship: speciesData.baseHappiness ?? 70,
    heldItem: null,
    // 생성 시 일반 특성 중 무작위 1개(균등). 숨은 특성은 특성패치로만.
    abilityId: pickAbilityId(speciesData),
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature,
    isShiny: Math.random() < getShinyRate(),
  };
}

export function createWildPokemon(species: string, level: number): WildPokemon {
  const { baseSpecies, variantId, speciesData } = resolveSpeciesOrVariant(species);
  if (!speciesData) {
    throw new Error(`Unknown species: ${species}`);
  }

  const nature = pickRandomNature();
  const ivs = randomIvs();
  const { maxHp, stats } = buildStats(speciesData, level, nature, variantId, ivs);
  const moves = buildMoves(speciesData, level);

  return {
    species: baseSpecies,
    variantId: variantId ?? null,
    level,
    hp: maxHp,
    maxHp,
    stats,
    ivs,
    moves,
    nature,
    gender: resolvePokemonGender(speciesData.genderRate, Math.random()),
    // 야생도 일반 특성 중 무작위 1개(균등). 숨은 특성은 특성패치로만.
    ability: pickAbilityId(speciesData) ?? undefined,
    isShiny: Math.random() < getShinyRate(),
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
    exp: getExpForLevelInGroup(speciesData?.expGroup ?? "medium", wild.level),
    hp: wild.hp,
    maxHp: wild.maxHp,
    stats: { ...wild.stats },
    // 잡은 개체는 야생의 IV를 그대로 물려받는다(야생 전투 스탯과 일치). 레거시 야생(ivs 없음)은
    // normalizeOwnedPokemon이 마이그레이션한다.
    ivs: wild.ivs ? { ...wild.ivs } : undefined,
    // 야생은 EV를 쌓지 않으므로 잡은 개체는 0에서 시작한다.
    evs: emptyEvs(),
    moves: wild.moves.map((move) => ({ ...move })),
    caughtAt: new Date().toISOString(),
    gender: wild.gender ?? null,
    friendship: speciesData?.baseHappiness ?? 70,
    heldItem: null,
    // 포획 개체는 야생이 이미 정한 특성을 물려받고, 레거시 야생(ability 없음)만 무작위로 폴백한다.
    abilityId: wild.ability ?? (speciesData ? pickAbilityId(speciesData) : null),
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: wild.nature ?? "hardy",
    isShiny: wild.isShiny ?? false,
  };
}

export function getAllSpecies(): Array<{ id: number; species: string; name: string }> {
  return getAllSpeciesList();
}
