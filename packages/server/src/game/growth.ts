import { getMoveById, getSpeciesByName, getEvolutions, getVariantById } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { getDamageTakenTotal } from "./battle-progress.js";
import { getMoveUsageCount } from "./move-usage.js";
import { calculateStatsForLevel } from "./pokemon-stats.js";
import type {
  EvolutionBranch,
  EvolutionCondition,
  EvolutionTimeOfDay,
  OwnedPokemon,
  PokemonGender,
  PokemonMove,
} from "../../../../shared/types.js";

export { calculateStatsForLevel };

const LOCATION_REGION_ALIASES: Record<string, string[]> = {
  alola: ["vast-poni-canyon", "blush-mountain", "mount-lanakila"],
  sinnoh: ["eterna-forest", "sinnoh-route-217", "mt-coronet"],
  unova: ["pinwheel-forest", "twist-mountain", "chargestone-cave"],
  kalos: ["kalos-route-20", "frost-cavern", "kalos-route-13"],
};

const RAIN_REGION_SUBSTITUTES = new Set(["kalos", "hisui"]);

export function getExpForLevel(level: number): number {
  return level ** 3;
}

export interface ApplyExpResult {
  leveled: boolean;
  newLevel: number;
  learnedMoves: string[];
  /** 4개 한도를 넘겨 자동으로 못 배운 기술 id들 — 플레이어 결정(잊기/안배우기) 대기 대상. */
  pendingMoveLearns: string[];
  /** Single matching evolution branch that was applied immediately. */
  evolvedBranch: EvolutionBranch | null;
  /** Multiple matching branches that require a pending player choice. */
  pendingBranches: EvolutionBranch[];
}

/**
 * Apply EXP to a single Pokemon and resolve all downstream growth effects:
 * level-up, learned moves, stat recalculation, and evolution branch matching.
 * Mutates `pokemon` in place. Evolution side effects that touch the owning user
 * (pokedex updates, queuing a pending-evolution choice) are returned to the
 * caller rather than applied here, so this stays free of user/storage deps.
 *
 * Shared by the commit reward path and the battle reward path.
 */
export function applyExpToPokemon(
  pokemon: OwnedPokemon,
  exp: number,
  context: { party: OwnedPokemon[]; now?: Date; region?: string },
): ApplyExpResult {
  const result: ApplyExpResult = {
    leveled: false,
    newLevel: pokemon.level,
    learnedMoves: [],
    pendingMoveLearns: [],
    evolvedBranch: null,
    pendingBranches: [],
  };

  if (exp <= 0) return result;

  pokemon.exp += exp;
  const levelUp = checkLevelUp(pokemon);
  if (!levelUp.leveled) return result;

  pokemon.level = levelUp.newLevel;
  result.leveled = true;
  result.newLevel = levelUp.newLevel;
  const moveResult = applyLearnedMoves(pokemon, levelUp.newMoves);
  result.learnedMoves = moveResult.learned;
  result.pendingMoveLearns = moveResult.pending;

  const newStats = calculateStatsForLevel(pokemon.species, levelUp.newLevel, pokemon.nature, pokemon.variantId, pokemon.ivs, pokemon.evs);
  pokemon.maxHp = newStats.maxHp;
  pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
  pokemon.stats = newStats.stats;

  const matchingBranches = getMatchingEvolutionBranches(pokemon.species, {
    level: levelUp.newLevel,
    ...buildLevelEvolutionContext(pokemon, context.party, {
      now: context.now,
      region: context.region,
    }),
  });

  if (matchingBranches.length === 1) {
    const branch = matchingBranches[0];
    evolvePokemon(pokemon, branch.targetSpecies, branch.targetVariantId);
    result.evolvedBranch = branch;
  } else if (matchingBranches.length > 1) {
    result.pendingBranches = matchingBranches;
  }

  return result;
}

export function checkLevelUp(pokemon: OwnedPokemon): {
  leveled: boolean;
  newLevel: number;
  newMoves: string[];
} {
  const speciesData = getSpeciesByName(pokemon.species);

  let currentLevel = pokemon.level;
  const newMoves: string[] = [];

  while (currentLevel < 100 && pokemon.exp >= getExpForLevel(currentLevel + 1)) {
    currentLevel++;

    // Check learnset for moves at this level
    if (speciesData) {
      const movesAtLevel = speciesData.learnset.levelUp[String(currentLevel)];
      if (movesAtLevel) {
        newMoves.push(...movesAtLevel);
      }
    }
  }

  return {
    leveled: currentLevel > pokemon.level,
    newLevel: currentLevel,
    newMoves,
  };
}

/** 기술 슬롯 1개 생성 — pp/maxPp는 기술 데이터에서(없으면 10). pending-move-learn도 재사용. */
export function buildMoveSlot(moveId: string): PokemonMove {
  const moveData = getMoveById(moveId);
  const pp = moveData?.pp ?? 10;
  return {
    id: moveId,
    pp,
    maxPp: pp,
  };
}

/**
 * 레벨업으로 새로 익힌 기술을 적용한다. 빈 슬롯(4개 미만)이 남아 있을 때만 추가하고,
 * 한도를 넘긴 기술은 **자동으로 밀어내지 않는다**(과거 FIFO shift 제거) — 대신 pending으로
 * 돌려줘 플레이어가 어떤 기술을 잊고 배울지(또는 안 배울지) 직접 고르게 한다.
 *  - learned: 실제로 추가된 기술 id(이미 알거나 빈 슬롯에 들어간 것).
 *  - pending: 자리 부족으로 못 배운 기술 id(이미 아는 기술은 제외).
 */
export function applyLearnedMoves(
  pokemon: OwnedPokemon,
  newMoveIds: string[],
  maxMoves: number = 4,
): { learned: string[]; pending: string[] } {
  const learned: string[] = [];
  const pending: string[] = [];

  for (const moveId of newMoveIds) {
    if (pokemon.moves.some((move) => move.id === moveId)) {
      continue;
    }

    if (pokemon.moves.length < maxMoves) {
      pokemon.moves.push(buildMoveSlot(moveId));
      learned.push(moveId);
    } else {
      pending.push(moveId);
    }
  }

  return { learned, pending };
}

function resolveEvolutionAbilityId(species: string, currentAbilityId: string | null | undefined): string | null {
  const speciesData = getSpeciesByName(species);
  if (!speciesData?.abilities) {
    return null;
  }

  const availableAbilityIds = [
    ...speciesData.abilities.normal,
    ...(speciesData.abilities.hidden ? [speciesData.abilities.hidden] : []),
  ];

  if (currentAbilityId && availableAbilityIds.includes(currentAbilityId)) {
    return currentAbilityId;
  }

  return speciesData.abilities.normal[0] ?? speciesData.abilities.hidden ?? null;
}

export function evolvePokemon(pokemon: OwnedPokemon, targetSpecies: string, targetVariantId?: string | null): OwnedPokemon {
  const targetSpeciesData = getSpeciesByName(targetSpecies);
  if (!targetSpeciesData) {
    // GameRuleError로 던져 아이템 진화·resolve 라우트가 500 대신 깔끔한 4xx를 반환하게 한다.
    throw new GameRuleError(`진화 대상 종을 찾을 수 없습니다: ${targetSpecies}`);
  }

  pokemon.species = targetSpecies;
  pokemon.variantId = targetVariantId ?? null;

  // Mirror the wild/created-pokemon convention (pokemon-factory.createPokemon):
  // stored stats bake in the variant's baseStatsOverride, so pass the variant
  // id through to calculateStatsForLevel and persist the form's stats.
  const evolvedStats = calculateStatsForLevel(targetSpecies, pokemon.level, pokemon.nature, pokemon.variantId, pokemon.ivs, pokemon.evs);
  pokemon.maxHp = evolvedStats.maxHp;
  pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
  pokemon.stats = evolvedStats.stats;
  pokemon.abilityId = resolveEvolutionAbilityId(targetSpecies, pokemon.abilityId);

  return pokemon;
}

export interface EvolutionCheckContext {
  level: number;
  usedItem?: string | null;
  friendship?: number;
  heldItem?: string | null;
  timeOfDay?: EvolutionTimeOfDay;
  knownMoveIds?: string[];
  knownMoveTypes?: string[];
  gender?: PokemonGender | null;
  region?: string;
  attack?: number;
  defense?: number;
  partySpecies?: string[];
  partyTypes?: string[];
  moveUsageCounts?: Record<string, number>;
  damageTakenTotal?: number;
  tradePartnerSpecies?: string;
}

export type EvolutionBranchDiagnosticStatus = "available" | "blocked" | "unsupported";

export interface EvolutionBranchDiagnostic {
  branchId: string;
  targetSpecies: string;
  /** Variant form the branch evolves into, when it differs from the base species. */
  targetVariantId?: string;
  /** Display name of the target — the variant's name when targetVariantId is set, else the species name. */
  targetName: string;
  trigger: string;
  status: EvolutionBranchDiagnosticStatus;
  requirements: string[];
  blockers: string[];
}

/**
 * Display name for an evolution target. Prefers the variant's name when the
 * branch points at a variant form (e.g. Lycanroc Midnight); otherwise falls
 * back to the species display name.
 */
function getEvolutionTargetName(targetSpecies: string, targetVariantId?: string | null): string {
  if (targetVariantId) {
    const variant = getVariantById(targetVariantId);
    if (variant) {
      return variant.name;
    }
  }
  return getSpeciesByName(targetSpecies)?.name ?? targetSpecies;
}

export function getEvolutionTimeOfDay(now: Date = new Date()): EvolutionTimeOfDay {
  const hour = now.getHours();
  return hour >= 6 && hour < 18 ? "day" : "night";
}

function getLocationRegions(location: string): string[] {
  return Object.entries(LOCATION_REGION_ALIASES)
    .filter(([, locations]) => locations.includes(location))
    .map(([region]) => region);
}

function affectionToFriendshipThreshold(value: unknown): number | null {
  const affection = Number(value);
  if (!Number.isFinite(affection) || affection <= 0) {
    return null;
  }

  if (affection >= 5) return 220;
  if (affection >= 4) return 200;
  if (affection >= 3) return 160;
  if (affection >= 2) return 120;
  return 80;
}

function isTriggerSupported(trigger: EvolutionBranch["trigger"]): boolean {
  return trigger !== "trade";
}

function getUnsupportedTriggerReason(trigger: EvolutionBranch["trigger"]): string {
  if (trigger === "trade") {
    return "Requires trade with another user";
  }

  return `Evolution trigger '${trigger}' is not implemented yet`;
}

function getExtraMoveId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" && name.length > 0 ? name : null;
  }

  return null;
}

function getBranchUsedMoveId(branch: EvolutionBranch): string | null {
  const condition = branch.conditions.find((entry) => entry.type === "extra" && entry.key === "used_move");
  return condition?.type === "extra" ? getExtraMoveId(condition.value) : null;
}

function getExtraSpeciesId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" && name.length > 0 ? name : null;
  }

  return null;
}

function formatCondition(condition: EvolutionCondition, branch?: EvolutionBranch): string {
  switch (condition.type) {
    case "level":
      return `Level ${condition.level}+`;
    case "item-use":
      return `Use ${condition.item}`;
    case "friendship":
      return `Friendship ${condition.min}+`;
    case "held-item":
      return `Hold ${condition.item}`;
    case "time":
      return `Time: ${condition.value}`;
    case "trade":
      return "Trade";
    case "region":
      return `Region: ${condition.region}`;
    case "gender":
      return `Gender: ${condition.value}`;
    case "known-move":
      return `Know move: ${condition.moveId}`;
    case "known-move-type":
      return `Know ${condition.moveType}-type move`;
    case "location":
      return `Location family: ${condition.location}`;
    case "stat-compare":
      if (condition.op === "gt") return "Attack > Defense";
      if (condition.op === "lt") return "Attack < Defense";
      return "Attack = Defense";
    case "party-member":
      if (condition.species) {
        return `Party member: ${condition.species}`;
      }
      return `Party type: ${condition.pokemonType}`;
    case "extra":
      if (condition.key === "min_affection") {
        return `Affection ${String(condition.value)}+`;
      }
      if (condition.key === "min_beauty") {
        return `Beauty ${String(condition.value)}+`;
      }
      if (condition.key === "min_damage_taken") {
        return `Take ${String(condition.value)}+ total damage`;
      }
      if (condition.key === "needs_overworld_rain") {
        return "Rain-region substitute";
      }
      if (condition.key === "turn_upside_down") {
        return "Know move: topsy-turvy";
      }
      if (condition.key === "used_move") {
        return `Use move: ${getExtraMoveId(condition.value) ?? "specified move"}`;
      }
      if (condition.key === "min_move_count") {
        const moveId = branch ? getBranchUsedMoveId(branch) : null;
        if (moveId) {
          return `Use ${moveId} ${String(condition.value)} times`;
        }
        return `Use a move ${String(condition.value)} times`;
      }
      if (condition.key === "trade_species") {
        return `Trade with ${getExtraSpeciesId(condition.value) ?? "specified species"}`;
      }
      return `Special condition: ${condition.key}`;
    default:
      return "Unknown requirement";
  }
}

function isConditionSupported(condition: EvolutionCondition, branch?: EvolutionBranch): boolean {
  switch (condition.type) {
    case "trade":
      return false;
    case "extra":
      return condition.key === "min_affection"
        || condition.key === "min_beauty"
        || condition.key === "min_damage_taken"
        || condition.key === "needs_overworld_rain"
        || condition.key === "turn_upside_down"
        || condition.key === "used_move"
        || condition.key === "trade_species"
        || (condition.key === "min_move_count"
          && Number.isFinite(Number(condition.value))
          && (branch == null || getBranchUsedMoveId(branch) !== null));
    default:
      return true;
  }
}

function getUnsupportedReason(condition: EvolutionCondition, branch?: EvolutionBranch): string {
  switch (condition.type) {
    case "trade":
      return "Trade evolution is not implemented yet";
    case "extra":
      return `Special evolution condition '${condition.key}' is not implemented yet`;
    default:
      return `${formatCondition(condition, branch)} is not implemented yet`;
  }
}

function getConditionBlocker(
  condition: EvolutionCondition,
  context: EvolutionCheckContext,
  branch?: EvolutionBranch,
): string {
  switch (condition.type) {
    case "level":
      return `Level ${condition.level}+ (current ${context.level})`;
    case "friendship":
      return `Friendship ${condition.min}+ (current ${context.friendship ?? 0})`;
    case "region":
      return `Region: ${condition.region} (current ${context.region ?? "none"})`;
    case "gender":
      return `Gender: ${condition.value} (current ${context.gender ?? "unknown"})`;
    case "known-move":
      return `Know move: ${condition.moveId}`;
    case "known-move-type":
      return `Know ${condition.moveType}-type move`;
    case "location":
      return `Location family: ${condition.location} (current region ${context.region ?? "none"})`;
    case "stat-compare":
      return `${formatCondition(condition, branch)} (current A ${context.attack ?? "?"} / D ${context.defense ?? "?"})`;
    case "extra":
      if (condition.key === "used_move") {
        const moveId = getExtraMoveId(condition.value) ?? "specified move";
        const currentCount = getMoveUsageCount(context.moveUsageCounts, moveId);
        return `Use move: ${moveId} (${currentCount}/1)`;
      }
      if (condition.key === "min_beauty") {
        return `Beauty ${String(condition.value)}+ (using friendship ${context.friendship ?? 0})`;
      }
      if (condition.key === "min_damage_taken") {
        const required = Math.max(0, Number(condition.value) || 0);
        const current = getDamageTakenTotal(context.damageTakenTotal);
        return `Take ${required}+ total damage (${current}/${required})`;
      }
      if (condition.key === "needs_overworld_rain") {
        return `Rain-region substitute (current ${context.region ?? "none"})`;
      }
      if (condition.key === "turn_upside_down") {
        return "Know move: topsy-turvy";
      }
      if (condition.key === "min_move_count") {
        const minCount = Number(condition.value) || 0;
        const moveId = branch ? getBranchUsedMoveId(branch) : null;
        if (moveId) {
          const currentCount = getMoveUsageCount(context.moveUsageCounts, moveId);
          return `Use ${moveId} ${minCount} times (${currentCount}/${minCount})`;
        }
      }
      if (condition.key === "trade_species") {
        const tradePartnerSpecies = getExtraSpeciesId(condition.value) ?? "specified species";
        return `Trade with ${tradePartnerSpecies} (current ${context.tradePartnerSpecies ?? "none"})`;
      }
      return formatCondition(condition, branch);
    default:
      return formatCondition(condition, branch);
  }
}

export function buildLevelEvolutionContext(
  pokemon: OwnedPokemon,
  party: OwnedPokemon[],
  options: {
    now?: Date;
    region?: string;
    gender?: PokemonGender | null;
  } = {},
): Omit<EvolutionCheckContext, "level"> {
  const knownMoveIds = pokemon.moves.map((move) => move.id);
  const knownMoveTypes = [...new Set(
    knownMoveIds
      .map((moveId) => getMoveById(moveId)?.type)
      .filter((type): type is string => Boolean(type)),
  )];
  const partySpecies = [...new Set(party.map((member) => member.species))];
  const partyTypes = [...new Set(
    party
      .flatMap((member) => getSpeciesByName(member.species)?.types ?? []),
  )];

  return {
    friendship: pokemon.friendship ?? 70,
    heldItem: pokemon.heldItem ?? null,
    timeOfDay: getEvolutionTimeOfDay(options.now),
    knownMoveIds,
    knownMoveTypes,
    gender: options.gender ?? pokemon.gender ?? null,
    region: options.region,
    attack: pokemon.stats.attack,
    defense: pokemon.stats.defense,
    partySpecies,
    partyTypes,
    moveUsageCounts: pokemon.moveUsageCounts ?? {},
    damageTakenTotal: pokemon.damageTakenTotal ?? 0,
  };
}

function isConditionMet(
  condition: EvolutionCondition,
  context: EvolutionCheckContext,
  branch?: EvolutionBranch,
): boolean {
  switch (condition.type) {
    case "level":
      return context.level >= condition.level;
    case "item-use":
      return context.usedItem === condition.item;
    case "friendship":
      return (context.friendship ?? 0) >= condition.min;
    case "held-item":
      return context.heldItem === condition.item;
    case "time":
      return context.timeOfDay === condition.value;
    case "trade":
      return false;
    case "region":
      return context.region === condition.region;
    case "gender":
      return context.gender === condition.value;
    case "known-move":
      return (context.knownMoveIds ?? []).includes(condition.moveId);
    case "known-move-type":
      return (context.knownMoveTypes ?? []).includes(condition.moveType);
    case "location":
      return getLocationRegions(condition.location).includes(context.region ?? "");
    case "stat-compare":
      if (context.attack == null || context.defense == null) {
        return false;
      }
      if (condition.op === "gt") return context.attack > context.defense;
      if (condition.op === "lt") return context.attack < context.defense;
      return context.attack === context.defense;
    case "party-member":
      return Boolean(
        (condition.species && (context.partySpecies ?? []).includes(condition.species))
        || (condition.pokemonType && (context.partyTypes ?? []).includes(condition.pokemonType)),
      );
    case "extra":
      if (condition.key === "min_affection") {
        const friendshipThreshold = affectionToFriendshipThreshold(condition.value);
        return friendshipThreshold != null && (context.friendship ?? 0) >= friendshipThreshold;
      }
      if (condition.key === "min_beauty") {
        const minBeauty = Number(condition.value);
        return Number.isFinite(minBeauty) && (context.friendship ?? 0) >= minBeauty;
      }
      if (condition.key === "min_damage_taken") {
        const minDamageTaken = Number(condition.value);
        return Number.isFinite(minDamageTaken) && getDamageTakenTotal(context.damageTakenTotal) >= minDamageTaken;
      }
      if (condition.key === "needs_overworld_rain") {
        return RAIN_REGION_SUBSTITUTES.has(context.region ?? "");
      }
      if (condition.key === "turn_upside_down") {
        return (context.knownMoveIds ?? []).includes("topsy-turvy");
      }
      if (condition.key === "used_move") {
        const moveId = getExtraMoveId(condition.value);
        return moveId != null && getMoveUsageCount(context.moveUsageCounts, moveId) > 0;
      }
      if (condition.key === "min_move_count") {
        const minCount = Number(condition.value);
        if (!Number.isFinite(minCount) || minCount <= 0) {
          return false;
        }

        const moveId = branch ? getBranchUsedMoveId(branch) : null;
        if (moveId) {
          return getMoveUsageCount(context.moveUsageCounts, moveId) >= minCount;
        }

        const counts = Object.values(context.moveUsageCounts ?? {});
        return counts.length > 0 && Math.max(...counts) >= minCount;
      }
      if (condition.key === "trade_species") {
        const species = getExtraSpeciesId(condition.value);
        return species != null && context.tradePartnerSpecies === species;
      }
      return false;
    default:
      return false;
  }
}

function branchMatches(branch: EvolutionBranch, context: EvolutionCheckContext): boolean {
  if (!isTriggerSupported(branch.trigger)) {
    return false;
  }

  return branch.conditions.every((condition) => isConditionMet(condition, context, branch));
}

export function getEvolutionBranchDiagnostics(
  species: string,
  context: EvolutionCheckContext,
): EvolutionBranchDiagnostic[] {
  const evolution = getEvolutions();
  const evo = evolution[species];
  if (!evo || evo.branches.length === 0) {
    return [];
  }

  return evo.branches.map((branch) => {
    const requirements = branch.conditions.map((condition) => formatCondition(condition, branch));
    const blockers: string[] = [];
    let status: EvolutionBranchDiagnosticStatus = "available";

    if (!isTriggerSupported(branch.trigger)) {
      blockers.push(getUnsupportedTriggerReason(branch.trigger));
      status = "unsupported";
    }

    for (const condition of branch.conditions) {
      if (!isConditionSupported(condition, branch)) {
        blockers.push(getUnsupportedReason(condition, branch));
        status = "unsupported";
        continue;
      }

      if (status === "unsupported") {
        continue;
      }

      if (!isConditionMet(condition, context, branch)) {
        blockers.push(getConditionBlocker(condition, context, branch));
        status = "blocked";
      }
    }

    return {
      branchId: branch.id,
      targetSpecies: branch.targetSpecies,
      ...(branch.targetVariantId ? { targetVariantId: branch.targetVariantId } : {}),
      targetName: getEvolutionTargetName(branch.targetSpecies, branch.targetVariantId),
      trigger: branch.trigger,
      status,
      requirements,
      blockers,
    };
  });
}

export function getMatchingEvolutionBranches(species: string, context: EvolutionCheckContext): EvolutionBranch[] {
  const evolution = getEvolutions();
  const evo = evolution[species];
  if (!evo || evo.branches.length === 0) {
    return [];
  }

  // 대상 종이 데이터(species.json)에 존재하지 않는 분기는 애초에 진화가 불가능하므로 제외한다
  // (예: applin→dipplin). 이런 분기가 매칭되면 존재하지 않는 종으로의 pending 진화가 잘못
  // 큐잉되고, resolve 시 evolvePokemon이 예외를 던져 진화 UI 전체가 막힌다.
  return evo.branches.filter(
    (branch) => getSpeciesByName(branch.targetSpecies) != null && branchMatches(branch, context),
  );
}

export function resolveEvolution(species: string, context: EvolutionCheckContext): EvolutionBranch | null {
  return getMatchingEvolutionBranches(species, context)[0] ?? null;
}

export function resolveTradeEvolution(species: string, context: Omit<EvolutionCheckContext, "level"> = {}): EvolutionBranch | null {
  const evolution = getEvolutions();
  const evo = evolution[species];
  if (!evo || evo.branches.length === 0) {
    return null;
  }

  return evo.branches.find((branch) => (
    branch.trigger === "trade"
    && branch.conditions.every((condition) => isConditionSupported(condition, branch))
    && branch.conditions.every((condition) => isConditionMet(condition, { level: 0, ...context }, branch))
  )) ?? null;
}

export function checkEvolution(species: string, level: number, context: Omit<EvolutionCheckContext, "level"> = {}): string | null {
  const branch = resolveEvolution(species, { level, ...context });
  if (!branch) {
    return null;
  }

  return branch.targetSpecies;
}

export function getEvolutionItemUseTarget(species: string, item: string): { targetSpecies: string; targetVariantId?: string } | null {
  const branch = resolveEvolution(species, { level: 0, usedItem: item });
  if (!branch) {
    return null;
  }

  return { targetSpecies: branch.targetSpecies, targetVariantId: branch.targetVariantId };
}

export function getEvolutionBranches(species: string): EvolutionBranch[] {
  return getEvolutions()[species]?.branches ?? [];
}
