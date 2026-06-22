import type { OwnedPokemon } from "../../../../shared/types.js";

// ---------------------------------------------------------------------------
// 지닌물건(held item) 전투효과 — 순수 헬퍼 모음
//
// 모든 헬퍼는 heldItem이 없거나(undefined/null) 해당 아이템이 아니면 무효과로
// 동작(no-op)한다. 따라서 미지닌 경로는 도입 전과 완전히 동일하게 유지된다.
//
// 데이터(data/items/items.json)에 실제 존재하는 id만 참조한다:
//   leftovers, life-orb, focus-sash, focus-band, assault-vest,
//   muscle-band, wise-glasses, expert-belt, quick-claw, berry-juice
//
// 야생 포켓몬(WildPokemon)은 heldItem 필드가 없으므로, 모든 헬퍼는
// `heldItem?: string | null`만 가지면 되는 최소 형태(HeldItemHolder)를 받는다.
// ---------------------------------------------------------------------------

/** heldItem만 보면 되는 최소 형태 — OwnedPokemon/WildPokemon 모두 호환 */
export interface HeldItemHolder {
  heldItem?: string | null;
  hp: number;
  maxHp: number;
  species: string;
}

type MoveCategory = "physical" | "special" | "status" | string;

/**
 * 공격자 지닌물건의 공격 데미지 배율(적용 가능한 효과의 곱).
 * - life-orb: ×1.3 (반동은 applyLifeOrbRecoil에서 별도 처리)
 * - muscle-band: 물리 기술이면 ×1.1
 * - wise-glasses: 특수 기술이면 ×1.1
 * - expert-belt: 효과가 굉장(super-effective)하면 ×1.2
 * 미지닌/비대상이면 1을 반환한다.
 */
export function getHeldOffenseMultiplier(
  attacker: HeldItemHolder,
  category: MoveCategory,
  isSuperEffective: boolean,
): number {
  const item = attacker.heldItem;
  if (!item) return 1;
  let mult = 1;
  if (item === "life-orb") mult *= 1.3;
  if (item === "muscle-band" && category === "physical") mult *= 1.1;
  if (item === "wise-glasses" && category === "special") mult *= 1.1;
  if (item === "expert-belt" && isSuperEffective) mult *= 1.2;
  return mult;
}

/**
 * 방어자 지닌물건의 특수방어 배율.
 * - assault-vest: 특수 기술에 대해 SpDef ×1.5
 * 데미지식에서 def(특수방어)에 곱해 데미지를 줄이는 데 사용한다.
 * 미지닌/비대상이면 1을 반환한다.
 */
export function getHeldSpDefMultiplier(
  defender: HeldItemHolder,
  category: MoveCategory,
): number {
  if (defender.heldItem === "assault-vest" && category === "special") return 1.5;
  return 1;
}

/**
 * 생명의구슬(life-orb) 반동: 데미지를 입힌 공격(damage>0, 비-status) 직후
 * 보유자가 max(1, floor(maxHp/10)) HP를 잃는다. (소모되지 않음)
 * 보유하지 않았거나 이미 쓰러졌으면 아무 일도 하지 않는다.
 */
export function applyLifeOrbRecoil(
  attacker: HeldItemHolder,
  log: string[],
): void {
  if (attacker.heldItem !== "life-orb") return;
  if (attacker.hp <= 0) return;
  const recoil = Math.max(1, Math.floor(attacker.maxHp / 10));
  attacker.hp = Math.max(0, attacker.hp - recoil);
  log.push(`생명의구슬의 반동으로 ${recoil} 데미지!`);
}

export interface FocusSurviveResult {
  /** 적용 후 실제로 적용할 데미지 */
  finalDamage: number;
  /** 소모성 아이템(focus-sash)이 발동·소모됐는지 */
  consumed: boolean;
  /** 발동한 효과 종류 (없으면 null) */
  kind: "focus-sash" | "focus-band" | null;
}

/**
 * 일격 버티기(survive-a-KO) 판정 — post-damage HP를 쓰기 *전에* 호출한다.
 * - focus-sash: 풀피(atFullHp)에서 쓰러질 데미지(>= 현재 hp)면 HP 1만 남기고 소모.
 * - focus-band: (full 여부 무관) 10% 확률로 쓰러질 데미지를 HP 1로 버팀(소모 안 됨).
 * focus-sash를 우선 판정하고, 없을 때만 focus-band를 굴린다.
 *
 * 반환된 consumed가 true면 호출부에서 defender.heldItem = null로 소모를 반영한다.
 * 미지닌/비대상이거나 어차피 쓰러지지 않는 데미지면 입력 데미지를 그대로 돌려준다.
 */
export function tryFocusSurvive(
  defender: HeldItemHolder,
  incomingDamage: number,
  atFullHp: boolean,
  random: () => number = Math.random,
): FocusSurviveResult {
  const noChange: FocusSurviveResult = { finalDamage: incomingDamage, consumed: false, kind: null };
  // 쓰러지지 않는 데미지면 어떤 버티기도 발동하지 않는다.
  if (defender.hp <= 0) return noChange;
  if (incomingDamage < defender.hp) return noChange;

  if (defender.heldItem === "focus-sash" && atFullHp) {
    // HP 1만 남기고 소모
    return { finalDamage: defender.hp - 1, consumed: true, kind: "focus-sash" };
  }
  if (defender.heldItem === "focus-band" && random() < 0.1) {
    // HP 1로 버팀(소모되지 않음)
    return { finalDamage: defender.hp - 1, consumed: false, kind: "focus-band" };
  }
  return noChange;
}

/**
 * 턴 종료 회복(end-of-turn heal).
 * - leftovers: max(1, floor(maxHp/16)) 회복 (hp>0 이고 풀피가 아닐 때만, maxHp 상한)
 * 미지닌/비대상/쓰러짐/풀피면 아무 일도 하지 않는다.
 */
export function applyHeldEndOfTurnHeal(
  pokemon: HeldItemHolder,
  log: string[],
  displayName?: string,
): void {
  if (pokemon.heldItem !== "leftovers") return;
  if (pokemon.hp <= 0 || pokemon.hp >= pokemon.maxHp) return;
  const heal = Math.max(1, Math.floor(pokemon.maxHp / 16));
  pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + heal);
  const who = displayName ?? pokemon.species;
  log.push(`${who}이(가) 먹다남은음식으로 ${heal} 회복했다!`);
}

/**
 * 위기 시 회복 나무열매(pinch berry).
 * - berry-juice(기력의탄산수): 데미지를 받은 뒤 hp>0 이고 hp <= floor(maxHp/2)면
 *   20 HP 회복(maxHp 상한)하고 소모(heldItem=null).
 * 호출부에서 데미지 적용 직후/턴 종료에 호출한다.
 * 미지닌/비대상/쓰러짐/조건미달이면 아무 일도 하지 않는다.
 */
export function maybeConsumePinchBerry(
  pokemon: HeldItemHolder,
  log: string[],
  displayName?: string,
): void {
  if (pokemon.heldItem !== "berry-juice") return;
  if (pokemon.hp <= 0) return;
  if (pokemon.hp > Math.floor(pokemon.maxHp / 2)) return;
  pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + 20);
  pokemon.heldItem = null;
  const who = displayName ?? pokemon.species;
  log.push(`${who}이(가) 기력의탄산수로 회복했다!`);
}

/**
 * 선제공격손톱(quick-claw): 보유자가 20% 확률로 속도 무관 선공.
 * 턴 순서 결정에서 속도 비교 *전에* 호출한다.
 * 미지닌/비대상이면 false.
 */
export function quickClawTriggers(
  pokemon: HeldItemHolder,
  random: () => number = Math.random,
): boolean {
  if (pokemon.heldItem !== "quick-claw") return false;
  return random() < 0.2;
}
