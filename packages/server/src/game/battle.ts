import { getTypeChart } from "./data-loader.js";
import type { PokemonStats, MoveData, StatStages } from "../../../../shared/types.js";

export function defaultStatStages(): StatStages {
  return { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 };
}

export function applyStatStageMultiplier(baseStat: number, stage: number): number {
  // Pokemon stat stage multipliers: stage -6 to +6
  // Positive: (2+stage)/2, Negative: 2/(2+|stage|)
  const clamped = Math.max(-6, Math.min(6, stage));
  if (clamped >= 0) return Math.floor(baseStat * (2 + clamped) / 2);
  return Math.floor(baseStat * 2 / (2 + Math.abs(clamped)));
}

// 명중/회피 전용 단계 배율(본가식 — 데미지용 2기반표와 다른 비대칭표).
// 단계 0=3/3, 양수 +n=(3+n)/3, 음수 −n=2/(2+n). 입력은 (사용자 명중단계 − 상대 회피단계).
export function accuracyStageMultiplier(stage: number): number {
  const clamped = Math.max(-6, Math.min(6, stage));
  return clamped >= 0 ? (3 + clamped) / 3 : 2 / (2 - clamped);
}

export function applyStatChanges(
  stages: StatStages,
  changes: Array<{ stat: string; change: number }>,
): StatStages {
  // 누락 키(구버전 battleState)도 0으로 채워 accuracy/evasion 변화가 유실되지 않게 한다.
  const result = { ...defaultStatStages(), ...stages };
  for (const { stat, change } of changes) {
    if (stat in result) {
      result[stat as keyof StatStages] = Math.max(-6, Math.min(6, result[stat as keyof StatStages] + change));
    }
  }
  return result;
}

export interface DamageResult {
  damage: number;
  missed: boolean;
  effectiveness: number;
  message: string;
  critical: boolean;
}

// 급소(크리티컬) 데미지 배율 — 본가 Gen6+의 1.5배.
export const CRIT_MULTIPLIER = 1.5;

/**
 * 급소 발생 여부 굴림(순수 함수, 테스트 주입용 random).
 * critRate(급소 단계)별 본가 Gen6+ 확률: 0→1/24, 1→1/8, 2→1/2, 3 이상→필중(1/1).
 * 단계가 음수면 0으로 클램프한다.
 */
export function rollCritical(critRate: number, random: () => number = Math.random): boolean {
  const stage = Math.max(0, critRate);
  const critThresholds = [24, 8, 2, 1]; // stage 0=1/24, 1=1/8, 2=1/2, 3 이상=필중
  const critDenominator = critThresholds[Math.min(stage, 3)];
  return random() * critDenominator < 1;
}

/**
 * 테라스탈 STAB 보정 정보(선택). terastallize한 공격자의 STAB을 본가식으로 계산하기 위해
 * 호출처가 teraType(테라 타입)과 originalTypes(테라 전 원래 타입)를 함께 넘긴다.
 * 미지정이면 STAB은 종전과 동일(attackerTypes에 move.type 포함 시 1.5).
 */
export interface TeraStab {
  teraType: string;
  originalTypes: string[];
}

export function calculateDamage(
  attackerLevel: number,
  attackerStats: PokemonStats,
  defenderStats: PokemonStats,
  move: MoveData,
  attackerTypes: string[],
  defenderTypes: string[],
  attackerStages?: StatStages,
  defenderStages?: StatStages,
  weatherModifier: number = 1,
  teraStab?: TeraStab,
  accuracyMultiplier: number = 1,
  alwaysHit: boolean = false,
): DamageResult {
  const typeChart = getTypeChart();

  // Accuracy check. 본가에서 accuracy "—"(0/null)은 "필중"을 뜻한다(Swift·검무 등).
  // accuracy가 양수일 때만 명중 굴림을 하고, 0 이하면 반드시 명중시킨다.
  // 본가식: 유효명중 = 기술명중 × 단계배율 × 특성배율, 단계 = (사용자 명중 − 상대 회피), −6~+6 클램프.
  // alwaysHit(no-guard 등)이면 명중 굴림을 건너뛴다.
  if (move.accuracy > 0 && !alwaysHit) {
    const combinedStage = Math.max(
      -6,
      Math.min(6, (attackerStages?.accuracy ?? 0) - (defenderStages?.evasion ?? 0)),
    );
    const effectiveAccuracy = move.accuracy * accuracyStageMultiplier(combinedStage) * accuracyMultiplier;
    const accuracyRoll = Math.random() * 100;
    if (accuracyRoll >= effectiveAccuracy) {
      return { damage: 0, missed: true, effectiveness: 1, message: "공격이 빗나갔다!", critical: false };
    }
  }

  // Status moves (power 0): skip damage
  if (move.power === 0) {
    return { damage: 0, missed: false, effectiveness: 1, message: "", critical: false };
  }

  // Critical hit check — 급소 확률표는 순수 helper(rollCritical)로 분리.
  const critStage = move.meta?.critRate ?? 0;
  const isCritical = rollCritical(critStage);

  // Determine atk/def based on category, applying stat stages
  // If critical: ignore negative attacker stages and positive defender stages
  const isPhysical = move.category === "physical";
  const baseAtk = isPhysical ? attackerStats.attack : attackerStats.spAttack;
  const baseDef = isPhysical ? defenderStats.defense : defenderStats.spDefense;
  let atkStage = attackerStages ? (isPhysical ? attackerStages.attack : attackerStages.spAttack) : 0;
  let defStage = defenderStages ? (isPhysical ? defenderStages.defense : defenderStages.spDefense) : 0;
  if (isCritical) {
    atkStage = Math.max(atkStage, 0);
    defStage = Math.min(defStage, 0);
  }
  const atk = applyStatStageMultiplier(baseAtk, atkStage);
  const def = applyStatStageMultiplier(baseDef, defStage);

  // Type effectiveness: product of chart values for each defender type
  let typeMultiplier = 1;
  const moveTypeChart = typeChart[move.type] ?? {};
  for (const defType of defenderTypes) {
    const mult = moveTypeChart[defType];
    if (mult !== undefined) {
      typeMultiplier *= mult;
    }
  }

  // Effectiveness message
  let message = "";
  if (typeMultiplier === 0) {
    message = "효과가 없는 것 같다...";
  } else if (typeMultiplier >= 2.0) {
    message = "효과가 굉장했다!";
  } else if (typeMultiplier <= 0.5) {
    message = "효과가 별로인 듯하다...";
  }

  if (typeMultiplier === 0) {
    return { damage: 0, missed: false, effectiveness: 0, message, critical: false };
  }

  // STAB (Same-Type Attack Bonus)
  // 테라스탈 시(teraStab 제공) 본가식 보정:
  //  - 기술 타입 === 테라 타입: 원래 타입에도 그 타입이 있었으면 2.0(겹STAB), 아니면 1.5.
  //  - 기술 타입 !== 테라 타입이지만 원래 타입에 있으면 1.5(테라 후에도 원타입 STAB 유지).
  //  - 둘 다 아니면 1.0.
  // teraStab 미제공이면 종전과 byte-identical(attackerTypes 포함 여부로 1.5/1.0).
  let stab: number;
  if (teraStab) {
    if (move.type === teraStab.teraType) {
      stab = teraStab.originalTypes.includes(move.type) ? 2.0 : 1.5;
    } else if (teraStab.originalTypes.includes(move.type)) {
      stab = 1.5;
    } else {
      stab = 1.0;
    }
  } else {
    stab = attackerTypes.includes(move.type) ? 1.5 : 1.0;
  }

  // Critical hit multiplier
  const critMultiplier = isCritical ? CRIT_MULTIPLIER : 1.0;

  // Random factor
  const randomFactor = 0.85 + Math.random() * 0.15;

  // Damage formula
  const level = attackerLevel;
  const damage = Math.floor(
    (((2 * level / 5 + 2) * move.power * atk / def) / 50 + 2)
    * stab
    * typeMultiplier
    * weatherModifier
    * critMultiplier
    * randomFactor,
  );

  return { damage, missed: false, effectiveness: typeMultiplier, message, critical: isCritical };
}

export function determineTurnOrder(
  mySpeed: number,
  wildSpeed: number,
  myPriority: number = 0,
  wildPriority: number = 0,
): "player" | "wild" {
  if (myPriority !== wildPriority) {
    return myPriority > wildPriority ? "player" : "wild";
  }
  if (mySpeed > wildSpeed) return "player";
  if (wildSpeed > mySpeed) return "wild";
  return Math.random() < 0.5 ? "player" : "wild";
}
