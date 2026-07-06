import crypto from "node:crypto";
import type {
  EvolutionBranch,
  OwnedPokemon,
  PendingEvolution,
  PendingEvolutionOption,
  UserData,
} from "../../../../shared/types.js";
import { getSpeciesByName, getVariantById } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import {
  buildLevelEvolutionContext,
  evolvePokemon,
  getEvolutionBranches,
  getMatchingEvolutionBranches,
} from "./growth.js";
import { findPokemonByUid, getPartyPokemon } from "./pokemon-state.js";

export { GameRuleError as PendingEvolutionError };

/**
 * Display name for an evolution target. When the branch points at a variant
 * form (e.g. Lycanroc Midnight), prefer the variant's name so the portal can
 * label the chosen form correctly; otherwise fall back to the species name.
 */
function resolveTargetName(targetSpecies: string, targetVariantId?: string | null): string {
  if (targetVariantId) {
    const variant = getVariantById(targetVariantId);
    if (variant) {
      return variant.name;
    }
  }
  return getSpeciesByName(targetSpecies)?.name ?? targetSpecies;
}

function buildOption(branch: EvolutionBranch): PendingEvolutionOption {
  return {
    branchId: branch.id,
    targetSpecies: branch.targetSpecies,
    ...(branch.targetVariantId ? { targetVariantId: branch.targetVariantId } : {}),
    targetName: resolveTargetName(branch.targetSpecies, branch.targetVariantId),
  };
}

export function queuePendingEvolution(
  user: UserData,
  pokemon: OwnedPokemon,
  branches: EvolutionBranch[],
): PendingEvolution {
  const source = getSpeciesByName(pokemon.species);
  const pending: PendingEvolution = {
    id: crypto.randomUUID(),
    pokemonUid: pokemon.uid,
    sourceSpecies: pokemon.species,
    sourceName: source?.name ?? pokemon.species,
    trigger: branches[0]?.trigger ?? "other",
    options: branches.map(buildOption),
    createdAt: new Date().toISOString(),
  };

  const pendingEvolutions = user.pendingEvolutions ?? [];
  user.pendingEvolutions = pendingEvolutions.filter((entry) => entry.pokemonUid !== pokemon.uid);
  user.pendingEvolutions.push(pending);
  return pending;
}

/**
 * 특정 포켓몬이 지금 진화 가능한 분기 옵션을 계산해 반환한다(온디맨드 진화용). 레벨업
 * 자동 진화/큐잉을 없앤 대신, 목록/상세 응답과 evolve 엔드포인트가 이 함수로 "지금 가능한"
 * 진화지를 그때그때 계산한다. 레벨업 경로와 동일한 매칭 로직(getMatchingEvolutionBranches)을
 * 쓰므로:
 *  - item-use 조건이 없으므로 아이템 진화는 자연히 제외된다(아이템 진화는 가방에서 처리).
 *    트레이드 진화도 trigger 미지원으로 매칭되지 않는다.
 *  - 대상 종이 species.json에 없는 깨진 분기(예: applin→dipplin)도 이미 필터되어 제외된다.
 */
export function getAvailableEvolutionOptions(
  user: UserData,
  pokemon: OwnedPokemon,
  opts: { now?: Date; region?: string } = {},
): PendingEvolutionOption[] {
  const party = getPartyPokemon(user);
  const region = opts.region ?? user.currentRegion ?? "default";
  const branches = getMatchingEvolutionBranches(pokemon.species, {
    level: pokemon.level,
    ...buildLevelEvolutionContext(pokemon, party, { now: opts.now, region }),
  });
  return branches.map(buildOption);
}

/**
 * 잘못 자동 큐잉된(깨진) pending 진화를 정리한다. **옵션의 대상 종이 전부** 데이터에
 * 존재하지 않는 pending만 제거한다 — 예: applin→dipplin처럼 과거 growth.ts 버그로
 * 존재하지 않는 종(dipplin/kingambit/archaludon/urshifu)으로 쌓였던 것들. 대상이 하나라도
 * 존재하는 정상 pending(레벨업 진화 등)은 절대 건드리지 않는다. options가 없는 레거시 형태는
 * 대상을 판정할 수 없으므로 안전하게 보존한다.
 *
 * 제거한 개수를 반환한다.
 */
export function prunePendingEvolutions(user: UserData): number {
  const pendingEvolutions = user.pendingEvolutions ?? [];
  if (pendingEvolutions.length === 0) {
    return 0;
  }

  const kept = pendingEvolutions.filter((pending) => {
    const options = pending.options ?? [];
    // 판정할 옵션이 없으면(레거시/빈 형태) 대상을 알 수 없으므로 그대로 둔다.
    if (options.length === 0) {
      return true;
    }
    // 모든 옵션의 대상 종이 존재하지 않을 때만 깨진 것으로 보고 제거한다.
    const allTargetsMissing = options.every((option) => !getSpeciesByName(option.targetSpecies));
    return !allTargetsMissing;
  });

  const removed = pendingEvolutions.length - kept.length;
  if (removed > 0) {
    user.pendingEvolutions = kept;
  }
  return removed;
}

export function clearPendingEvolutionForPokemon(user: UserData, pokemonUid: string): void {
  user.pendingEvolutions = (user.pendingEvolutions ?? []).filter((entry) => entry.pokemonUid !== pokemonUid);
}

export function resolvePendingEvolutionChoice(
  user: UserData,
  pendingEvolutionId: string,
  branchId: string,
): { pendingEvolution: PendingEvolution; pokemon: OwnedPokemon; targetSpecies: string } {
  const pendingEvolutions = user.pendingEvolutions ?? [];
  const pendingEvolution = pendingEvolutions.find((entry) => entry.id === pendingEvolutionId);
  if (!pendingEvolution) {
    throw new GameRuleError("Pending evolution not found.", 404);
  }

  const option = pendingEvolution.options.find((entry) => entry.branchId === branchId);
  if (!option) {
    throw new GameRuleError("Evolution option not found.", 404);
  }

  const pokemon = findPokemonByUid(user, pendingEvolution.pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found.", 404);
  }
  if (pokemon.species !== pendingEvolution.sourceSpecies) {
    throw new GameRuleError("Pokemon species no longer matches the pending evolution.");
  }

  // The stored option is a snapshot from when the pending was queued and may
  // predate later evolution-data changes (e.g. a branch gaining a
  // targetVariantId). Resolve the branch from the CURRENT evolution data by id
  // and treat that as authoritative, falling back to the snapshot only if the
  // branch no longer exists.
  const currentBranch = getEvolutionBranches(pendingEvolution.sourceSpecies)
    .find((branch) => branch.id === branchId);
  const targetSpecies = currentBranch?.targetSpecies ?? option.targetSpecies;
  const targetVariantId = currentBranch ? currentBranch.targetVariantId : option.targetVariantId;

  evolvePokemon(pokemon, targetSpecies, targetVariantId);
  if (!user.pokedex.includes(targetSpecies)) {
    user.pokedex.push(targetSpecies);
  }

  user.pendingEvolutions = pendingEvolutions.filter((entry) => entry.id !== pendingEvolutionId);

  return {
    pendingEvolution,
    pokemon,
    targetSpecies,
  };
}
