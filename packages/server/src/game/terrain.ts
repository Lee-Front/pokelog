import type { BattleTerrain, PrimaryStatus } from "../../../../shared/types.js";

const TERRAIN_MOVES: Record<string, BattleTerrain> = {
  "electric-terrain": "electric",
  "grassy-terrain": "grassy",
  "misty-terrain": "misty",
  "psychic-terrain": "psychic",
};

const DEFAULT_TERRAIN_TURNS = 5;

/** 필드는 접지(grounded) 포켓몬에게만 작용한다. 비행 타입은 떠 있어 접지가 아니다. */
export function isGrounded(types: string[]): boolean {
  return !types.includes("flying");
}

/** Returns the terrain a move sets, or null if the move doesn't set terrain. */
export function getTerrainFromMove(moveId: string): BattleTerrain | null {
  return TERRAIN_MOVES[moveId] ?? null;
}

/**
 * Returns the type-based damage modifier for a given terrain and move type.
 * 일렉트릭/그래스/사이코 강화는 공격자가 접지일 때만, 미스트의 드래곤 반감은 대상이 접지일 때만 적용된다.
 */
export function getTerrainTypeModifier(
  terrain: BattleTerrain,
  moveType: string,
  attackerGrounded: boolean,
  targetGrounded: boolean,
): number {
  if (terrain === "electric") {
    if (moveType === "electric" && attackerGrounded) return 1.3;
  }
  if (terrain === "grassy") {
    if (moveType === "grass" && attackerGrounded) return 1.3;
  }
  if (terrain === "psychic") {
    if (moveType === "psychic" && attackerGrounded) return 1.3;
  }
  if (terrain === "misty") {
    if (moveType === "dragon" && targetGrounded) return 0.5;
  }
  return 1.0;
}

/**
 * Returns end-of-turn terrain healing.
 * Grassy: 접지 포켓몬은 1/16 maxHp 회복.
 */
export function getTerrainHeal(terrain: BattleTerrain, types: string[], maxHp: number): number {
  if (terrain === "grassy" && isGrounded(types)) {
    return Math.max(1, Math.floor(maxHp / 16));
  }
  return 0;
}

/**
 * 필드가 상태이상 부여를 막는지 여부.
 * Electric: 접지 대상은 잠듦(sleep) 불가.
 * Misty: 접지 대상은 5대 상태이상(poison/burn/paralysis/sleep/freeze) 모두 불가.
 */
export function terrainBlocksStatus(
  terrain: BattleTerrain | undefined,
  status: PrimaryStatus,
  targetGrounded: boolean,
): boolean {
  if (!terrain || !targetGrounded) return false;
  if (terrain === "electric") return status === "sleep";
  if (terrain === "misty") return true;
  return false;
}

/**
 * Tick terrain at end of turn. Returns updated terrain/turns and whether it expired.
 * When called with undefined terrain, returns expired: false and no terrain.
 */
export function tickTerrain(
  terrain: BattleTerrain | undefined,
  turns: number | undefined,
): { terrain?: BattleTerrain; turns?: number; expired: boolean } {
  if (!terrain || turns === undefined) {
    return { terrain: undefined, turns: undefined, expired: false };
  }
  const remaining = turns - 1;
  if (remaining <= 0) {
    return { terrain: undefined, turns: undefined, expired: true };
  }
  return { terrain, turns: remaining, expired: false };
}

/** Returns the default number of turns terrain lasts. */
export function getDefaultTerrainTurns(): number {
  return DEFAULT_TERRAIN_TURNS;
}
