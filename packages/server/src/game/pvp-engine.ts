/**
 * PvP 전투 엔진 — 라운드(턴) 기반 순수 해결 로직.
 *
 * PvE(battle-routes/battle-state)와 엮지 않고, 재사용 가능한 순수 전투 primitive만
 * 호출한다: battle.js의 calculateDamage·determineTurnOrder·applyStatChanges·
 * applyStatStageMultiplier, status-conditions.js의 상태이상 처리, pokemon-state.js의
 * getEffectiveTypes. 야생 AI는 없다 — 양측 다 유저가 제출한 행동.
 *
 * 결정적 테스트를 위해 PvP 고유 분기(속도 동률 타이브레이크 등)는 주입된 rng를 쓴다.
 * 데미지 난수(명중·급소·난수보정)·상태이상 발동 난수는 재사용 primitive 내부의
 * Math.random을 그대로 쓰므로, 그 경로를 결정적으로 만들려면 테스트에서 Math.random을
 * 모킹한다(기존 encounter.test.ts와 동일한 패턴).
 */
import { calculateDamage, applyStatChanges, applyStatStageMultiplier, defaultStatStages } from "./battle.js";
import { getEffectiveTypes } from "./pokemon-state.js";
import { getMoveById } from "./data-loader.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles,
  rollAilment, isVolatileAilment, addVolatile,
} from "./status-conditions.js";
import type {
  MoveData, PrimaryStatus, PvpAction, PvpCombatant, StatStages,
} from "../../../../shared/types.js";

/** 주입 가능한 난수원. 기본은 Math.random. */
export type Rng = () => number;
export const defaultRng: Rng = () => Math.random();

/** 매치의 한 진영을 엔진이 다루기 위한 최소 뷰(스토어의 PvpSide와 호환). */
export interface EngineSide {
  userId: string;
  nickname: string;
  team: PvpCombatant[];
  activeIndex: number;
}

const statusNames: Record<string, string> = {
  poison: "독", burn: "화상", paralysis: "마비", sleep: "잠듦", freeze: "얼음",
};

function active(side: EngineSide): PvpCombatant {
  return side.team[side.activeIndex];
}

/** 살아있는(hp>0) 팀원이 현재 출전 포켓몬 외에 더 있는지. */
export function hasAliveReserve(side: EngineSide): boolean {
  return side.team.some((p, i) => i !== side.activeIndex && p.hp > 0);
}

/** 팀 전멸 여부(교체 가능한 살아있는 포켓몬이 하나도 없음). */
export function isWipedOut(side: EngineSide): boolean {
  return side.team.every((p) => p.hp <= 0);
}

/** 화상 시 물리 공격력 반감을 반영한 스탯 복제. */
function effectiveStats(mon: PvpCombatant) {
  const stats = { ...mon.stats };
  if (mon.statusCondition === "burn") {
    stats.attack = Math.max(1, Math.floor(stats.attack / 2));
  }
  return stats;
}

/** 마비 시 속도 반감 + 스탯랭크 보정을 적용한 유효 속도. */
function effectiveSpeed(mon: PvpCombatant): number {
  let base = mon.stats.speed;
  if (mon.statusCondition === "paralysis") {
    base = Math.max(1, Math.floor(base / 2));
  }
  return applyStatStageMultiplier(base, mon.statStages.speed ?? 0);
}

/**
 * 메인시리즈식 행동 순서 결정: 교체는 항상 기술보다 먼저, 그 다음 우선도, 그 다음 속도,
 * 동률이면 주입된 rng로 타이브레이크. "challenger" 또는 "opponent" 우선을 반환.
 */
export function resolveActionOrder(
  challengerMon: PvpCombatant,
  challengerAction: PvpAction,
  opponentMon: PvpCombatant,
  opponentAction: PvpAction,
  rng: Rng,
): "challenger" | "opponent" {
  const cSwitch = challengerAction.kind === "switch";
  const oSwitch = opponentAction.kind === "switch";
  if (cSwitch !== oSwitch) return cSwitch ? "challenger" : "opponent";

  // 둘 다 기술이면 우선도 비교
  if (!cSwitch && !oSwitch) {
    const cPrio = getMoveById((challengerAction as { moveId: string }).moveId)?.priority ?? 0;
    const oPrio = getMoveById((opponentAction as { moveId: string }).moveId)?.priority ?? 0;
    if (cPrio !== oPrio) return cPrio > oPrio ? "challenger" : "opponent";
  }

  const cSpeed = effectiveSpeed(challengerMon);
  const oSpeed = effectiveSpeed(opponentMon);
  if (cSpeed !== oSpeed) return cSpeed > oSpeed ? "challenger" : "opponent";
  return rng() < 0.5 ? "challenger" : "opponent";
}

/** 라운드 1회 해결 결과. */
export interface RoundOutcome {
  messages: string[];
  /** 라운드 중 어느 한쪽 활성 포켓몬이 기절했는지(강제 교체 필요 신호). */
  challengerFainted: boolean;
  opponentFainted: boolean;
}

/** 교체 실행(살아있는 팀원으로). 메시지만 남기고 활성 인덱스 변경. */
function applySwitch(side: EngineSide, teamIndex: number, messages: string[]): void {
  const target = side.team[teamIndex];
  side.activeIndex = teamIndex;
  // 교체 시 스탯랭크·휘발성 상태 초기화(메인시리즈 규칙).
  target.statStages = defaultStatStages();
  target.volatile = [];
  messages.push(`${side.nickname}: ${target.nickname ?? target.species}(으)로 교체했다!`);
}

/** ailment/stat-change 적용 — PvP 고유 rng 사용(테스트 결정성). 공격이 명중·유효했을 때만 호출. */
function applyMoveSecondaryEffects(
  move: MoveData,
  attacker: PvpCombatant,
  defender: PvpCombatant,
  rng: Rng,
  messages: string[],
): void {
  // 상태이상(주 상태 / 휘발성)
  const ailment = move.meta?.ailment;
  const chance = move.meta?.ailmentChance ?? 0;
  if (ailment && ailment !== "none") {
    const passes = !(chance > 0 && chance < 100) || rng() * 100 < chance;
    if (passes) {
      const primary = rollAilmentDeterministic(ailment, defender.statusCondition);
      if (primary) {
        defender.statusCondition = primary;
        if (primary === "sleep") defender.sleepTurns = 1 + Math.floor(rng() * 3);
        messages.push(`${defender.nickname ?? defender.species}은(는) ${statusNames[primary] ?? primary} 상태가 되었다!`);
      } else if (isVolatileAilment(ailment)) {
        const turns = ailment === "confusion" ? 1 + Math.floor(rng() * 4) : -1;
        const next = addVolatile(defender.volatile, ailment, turns);
        if (next !== defender.volatile) {
          defender.volatile = next;
          messages.push(`${defender.nickname ?? defender.species}은(는) ${ailment} 상태가 되었다!`);
        }
      }
    }
  }

  // 스탯 변화
  const changes = move.statChanges;
  if (changes && changes.length > 0) {
    const statChance = move.meta?.statChance ?? 100;
    if (!(statChance < 100) || rng() * 100 < statChance) {
      const targetsSelf = move.target === "user" || move.target === "user-and-allies" || move.target === "users-field";
      for (const { stat, change } of changes) {
        const toSelf = targetsSelf || change > 0;
        const recipient = toSelf ? attacker : defender;
        recipient.statStages = applyStatChanges(recipient.statStages, [{ stat, change }]);
        messages.push(`${recipient.nickname ?? recipient.species}의 ${stat}이(가) ${change > 0 ? "올랐다" : "내려갔다"}!`);
      }
    }
  }

  // drain/healing
  const meta = move.meta;
  if (meta?.healing) {
    const heal = Math.floor(attacker.maxHp * meta.healing / 100);
    if (heal > 0) {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
      messages.push(`${attacker.nickname ?? attacker.species}은(는) 체력을 회복했다!`);
    }
  }
}

/** primary 상태이상 여부만 판정(확률은 호출부에서 이미 처리). */
function rollAilmentDeterministic(ailment: string, current: PrimaryStatus | null | undefined): PrimaryStatus | null {
  // rollAilment는 내부에서 Math.random을 또 굴리므로, 확률 100으로 호출해 결정성 확보.
  return rollAilment(ailment, 100, current);
}

/** 한쪽의 기술 1회 실행(데미지·2차효과). 기절 여부 갱신 후 메시지 반환. */
function executeMove(
  attackerSide: EngineSide,
  defenderSide: EngineSide,
  moveId: string,
  rng: Rng,
  messages: string[],
): void {
  const attacker = active(attackerSide);
  const defender = active(defenderSide);

  // 행동 전 상태 체크(잠듦·얼음·마비·혼란). 잠듦 턴 감소는 여기서 처리.
  if (attacker.statusCondition === "sleep") {
    if (attacker.sleepTurns !== undefined && attacker.sleepTurns > 0) attacker.sleepTurns -= 1;
    if (attacker.sleepTurns !== undefined && attacker.sleepTurns <= 0) {
      attacker.statusCondition = null;
      attacker.sleepTurns = undefined;
      messages.push(`${attacker.nickname ?? attacker.species}은(는) 잠에서 깨어났다!`);
    }
  }
  if (attacker.statusCondition || attacker.volatile.length > 0) {
    const pre = checkPreAttack(attacker.statusCondition, attacker.volatile, attacker.stats, attacker.level);
    if (pre.statusCleared) {
      attacker.statusCondition = null;
      attacker.sleepTurns = undefined;
      messages.push(`${attacker.nickname ?? attacker.species}: ${pre.message}`);
    } else if (!pre.canAct) {
      messages.push(`${attacker.nickname ?? attacker.species}: ${pre.message}`);
      if (pre.selfDamage) {
        attacker.hp = Math.max(0, attacker.hp - pre.selfDamage);
        messages.push(`${attacker.nickname ?? attacker.species}은(는) ${pre.selfDamage} 데미지를 받았다!`);
      }
      return;
    }
  }

  const moveData = getMoveById(moveId);
  const learned = attacker.moves.find((m) => m.id === moveId);
  if (!moveData || !learned) {
    messages.push(`${attacker.nickname ?? attacker.species}은(는) 그 기술을 쓸 수 없다!`);
    return;
  }
  if (learned.pp <= 0) {
    messages.push(`${attacker.nickname ?? attacker.species}: PP가 없다!`);
    return;
  }
  learned.pp -= 1;

  const result = calculateDamage(
    attacker.level,
    effectiveStats(attacker),
    defender.stats,
    moveData,
    getEffectiveTypes(attacker.species, attacker.variantId),
    getEffectiveTypes(defender.species, defender.variantId),
    attacker.statStages,
    defender.statStages,
  );

  if (moveData.power > 0) {
    defender.hp = Math.max(0, defender.hp - result.damage);
    messages.push(
      `${attacker.nickname ?? attacker.species}의 ${moveData.name}! ` +
      (result.missed ? "빗나갔다!" : `${result.damage} 데미지!`),
    );
  } else {
    messages.push(`${attacker.nickname ?? attacker.species}의 ${moveData.name}!`);
  }
  if (result.message) messages.push(result.message);

  if (!result.missed) {
    applyMoveSecondaryEffects(moveData, attacker, defender, rng, messages);
  }
}

/** 한쪽 활성 포켓몬에 턴 종료 효과(독·화상·씨뿌리기 등) 적용. */
function applyEndOfTurnFor(side: EngineSide, opponent: EngineSide, messages: string[]): void {
  const mon = active(side);
  const opp = active(opponent);
  const eot = applyEndOfTurn(mon.statusCondition, mon.volatile, mon.maxHp, opp.maxHp);
  if (eot.damage > 0) mon.hp = Math.max(0, mon.hp - eot.damage);
  if (eot.healing > 0) mon.hp = Math.min(mon.maxHp, mon.hp + eot.healing);
  if (eot.opponentHealing > 0) opp.hp = Math.min(opp.maxHp, opp.hp + eot.opponentHealing);
  for (const msg of eot.messages) messages.push(`${mon.nickname ?? mon.species}: ${msg}`);
  mon.volatile = tickVolatiles(mon.volatile);
}

/**
 * 라운드 1회 해결: 양측 행동을 순서대로 실행하고 턴 종료 효과를 적용한다.
 * combatant들을 in-place로 변경하고 메시지·기절 신호를 반환한다.
 * 호출부(매치 로직)가 기절 시 강제 교체/승패를 처리한다.
 */
export function resolveRound(
  challenger: EngineSide,
  challengerAction: PvpAction,
  opponent: EngineSide,
  opponentAction: PvpAction,
  rng: Rng = defaultRng,
): RoundOutcome {
  const messages: string[] = [];

  const cMon = active(challenger);
  const oMon = active(opponent);
  const order = resolveActionOrder(cMon, challengerAction, oMon, opponentAction, rng);

  const first = order === "challenger"
    ? { side: challenger, action: challengerAction, foe: opponent }
    : { side: opponent, action: opponentAction, foe: challenger };
  const second = order === "challenger"
    ? { side: opponent, action: opponentAction, foe: challenger }
    : { side: challenger, action: challengerAction, foe: opponent };

  for (const turn of [first, second]) {
    // 행동자가 직전 행동으로 이미 기절했으면 스킵(예: 선공에 후공이 쓰러짐).
    if (active(turn.side).hp <= 0) continue;
    if (turn.action.kind === "switch") {
      applySwitch(turn.side, turn.action.teamIndex, messages);
    } else {
      executeMove(turn.side, turn.foe, turn.action.moveId, rng, messages);
    }
  }

  // 턴 종료 효과 — 양측 활성 포켓몬이 아직 살아있을 때만 적용.
  if (active(challenger).hp > 0) applyEndOfTurnFor(challenger, opponent, messages);
  if (active(opponent).hp > 0) applyEndOfTurnFor(opponent, challenger, messages);

  const cMonEnd = active(challenger);
  const oMonEnd = active(opponent);
  if (cMonEnd.hp <= 0) messages.push(`${cMonEnd.nickname ?? cMonEnd.species}이(가) 쓰러졌다!`);
  if (oMonEnd.hp <= 0) messages.push(`${oMonEnd.nickname ?? oMonEnd.species}이(가) 쓰러졌다!`);

  return {
    messages,
    challengerFainted: cMonEnd.hp <= 0,
    opponentFainted: oMonEnd.hp <= 0,
  };
}

/** OwnedPokemon → PvpCombatant 스냅샷 변환에 쓰는 기본 statStages 생성 도우미 재노출. */
export function freshStatStages(): StatStages {
  return defaultStatStages();
}
