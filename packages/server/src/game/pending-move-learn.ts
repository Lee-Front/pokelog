import crypto from "node:crypto";
import type {
  OwnedPokemon,
  PendingMoveLearn,
  UserData,
} from "../../../../shared/types.js";
import { getMoveById } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { buildMoveSlot } from "./growth.js";
import { findPokemonByUid } from "./pokemon-state.js";

export { GameRuleError as PendingMoveLearnError };

const MAX_MOVES = 4;

/**
 * 레벨업으로 배우려던 기술이 4개 한도를 넘겼을 때 대기 결정을 쌓는다(진화 대기와 동일 패턴).
 * 각 moveId마다: 포켓몬이 이미 그 기술을 알거나, 같은 (pokemonUid, moveId) 대기가 이미 있으면
 * 건너뛴다(중복 방지). 그 외에는 PendingMoveLearn 한 건을 추가한다.
 */
export function queuePendingMoveLearns(
  user: UserData,
  pokemonUid: string,
  moveIds: string[],
): void {
  user.pendingMoveLearns ??= [];

  const pokemon = findPokemonByUid(user, pokemonUid);

  for (const moveId of moveIds) {
    // 이미 아는 기술이면 배울 필요가 없다.
    if (pokemon?.moves.some((move) => move.id === moveId)) {
      continue;
    }
    // 같은 포켓몬·같은 기술 대기가 이미 있으면 중복 추가하지 않는다.
    if (
      user.pendingMoveLearns.some(
        (entry) => entry.pokemonUid === pokemonUid && entry.moveId === moveId,
      )
    ) {
      continue;
    }

    user.pendingMoveLearns.push({
      id: crypto.randomUUID(),
      pokemonUid,
      moveId,
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * 대기 중 기술 배우기를 처리한다.
 *  - forgetMoveId가 null/undefined → SKIP(안 배우기): 대기만 제거하고 기술은 배우지 않는다.
 *  - 그 외(배우기): 포켓몬 기술이 4개 미만이면 forgetMoveId를 무시하고 그냥 추가하고,
 *    4개면 forgetMoveId가 현재 기술 중 하나여야 한다(아니면 GameRuleError) — 그 기술을 잊고
 *    새 기술을 배운다.
 * 어느 경우든 처리 후 대기를 제거한다. 포켓몬이 이미 그 기술을 알면 학습 없이 대기만 정리한다.
 */
export function resolvePendingMoveLearn(
  user: UserData,
  pendingMoveLearnId: string,
  forgetMoveId?: string | null,
): {
  pendingMoveLearn: PendingMoveLearn;
  pokemon: OwnedPokemon;
  learnedMoveId: string | null;
  forgottenMoveId: string | null;
  skipped: boolean;
} {
  const pendingMoveLearns = user.pendingMoveLearns ?? [];
  const pendingMoveLearn = pendingMoveLearns.find((entry) => entry.id === pendingMoveLearnId);
  if (!pendingMoveLearn) {
    throw new GameRuleError("Pending move learn not found.", 404);
  }

  const pokemon = findPokemonByUid(user, pendingMoveLearn.pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found.", 404);
  }

  const dropPending = () => {
    user.pendingMoveLearns = pendingMoveLearns.filter((entry) => entry.id !== pendingMoveLearnId);
  };

  // 이미 그 기술을 알고 있으면 학습 없이 대기만 제거한다(no-op learn).
  if (pokemon.moves.some((move) => move.id === pendingMoveLearn.moveId)) {
    dropPending();
    return { pendingMoveLearn, pokemon, learnedMoveId: null, forgottenMoveId: null, skipped: false };
  }

  // SKIP(안 배우기): 대기만 제거.
  if (forgetMoveId == null) {
    dropPending();
    return { pendingMoveLearn, pokemon, learnedMoveId: null, forgottenMoveId: null, skipped: true };
  }

  // 배우기 — 빈 슬롯이 있으면 forgetMoveId를 무시하고 그냥 추가.
  let forgottenMoveId: string | null = null;
  if (pokemon.moves.length < MAX_MOVES) {
    pokemon.moves.push(buildMoveSlot(pendingMoveLearn.moveId));
  } else {
    const forgetIndex = pokemon.moves.findIndex((move) => move.id === forgetMoveId);
    if (forgetIndex < 0) {
      throw new GameRuleError("forgetMoveId is not one of the pokemon's current moves.");
    }
    pokemon.moves.splice(forgetIndex, 1);
    pokemon.moves.push(buildMoveSlot(pendingMoveLearn.moveId));
    forgottenMoveId = forgetMoveId;
  }

  dropPending();
  return {
    pendingMoveLearn,
    pokemon,
    learnedMoveId: pendingMoveLearn.moveId,
    forgottenMoveId,
    skipped: false,
  };
}

/** 표시용 기술명(없으면 id 그대로). 라우트/응답 구성 편의를 위해 둔다. */
export function getMoveDisplayName(moveId: string): string {
  return getMoveById(moveId)?.name ?? moveId;
}
