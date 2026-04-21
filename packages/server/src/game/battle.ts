import { getTypeChart } from "./data-loader.js";
import type { PokemonStats, MoveData, StatStages } from "../../../../shared/types.js";

export function defaultStatStages(): StatStages {
  return { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 };
}

export function calculateAccuracy(moveAccuracy: number, attackerAccStage: number, defenderEvaStage: number): number {
  const accMult = attackerAccStage >= 0 ? (3 + attackerAccStage) / 3 : 3 / (3 + Math.abs(attackerAccStage));
  const evaMult = defenderEvaStage >= 0 ? 3 / (3 + defenderEvaStage) : (3 + Math.abs(defenderEvaStage)) / 3;
  return moveAccuracy * accMult * evaMult;
}

export function applyStatStageMultiplier(baseStat: number, stage: number): number {
  // Pokemon stat stage multipliers: stage -6 to +6
  // Positive: (2+stage)/2, Negative: 2/(2+|stage|)
  const clamped = Math.max(-6, Math.min(6, stage));
  if (clamped >= 0) return Math.floor(baseStat * (2 + clamped) / 2);
  return Math.floor(baseStat * 2 / (2 + Math.abs(clamped)));
}

export function applyStatChanges(
  stages: StatStages,
  changes: Array<{ stat: string; change: number }>,
): StatStages {
  const result = { ...stages };
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

/**
 * Compute the STAB (Same-Type Attack Bonus) multiplier for a move.
 *
 * Rules:
 *  - Move type matches Tera type AND one of the original types → "combined" STAB
 *    2.0x (base 1.5 * 1.33 ≈ 2.0). Adaptability stacks: 2.25x.
 *  - Move type matches Tera type but NOT any original type → 1.5x (Tera-only).
 *    Adaptability does NOT stack here (canon: adaptability applies to the user's
 *    intrinsic types, not the Tera-acquired type).
 *  - No Tera active, move type matches original types → 1.5x (classic STAB).
 *    Adaptability: 2.0x.
 *  - Otherwise: 1.0x.
 */
export function computeStab(
  moveType: string,
  originalTypes: string[],
  teraActive: boolean,
  teraType: string | null,
  hasAdaptability: boolean,
): number {
  const matchesOriginal = originalTypes.includes(moveType);
  const matchesTera = teraActive && teraType != null && moveType === teraType;

  if (matchesTera && matchesOriginal) {
    return hasAdaptability ? 2.25 : 2.0;
  }
  if (matchesTera && !matchesOriginal) {
    return 1.5;
  }
  if (matchesOriginal) {
    return hasAdaptability ? 2.0 : 1.5;
  }
  return 1.0;
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
  stabMultiplier?: number,
): DamageResult {
  const typeChart = getTypeChart();

  // Accuracy check
  const accuracyRoll = Math.random() * 100;
  if (accuracyRoll >= move.accuracy) {
    return { damage: 0, missed: true, effectiveness: 1, message: "공격이 빗나갔다!", critical: false };
  }

  // Status moves (power 0): skip damage
  if (move.power === 0) {
    return { damage: 0, missed: false, effectiveness: 1, message: "", critical: false };
  }

  // Critical hit check
  const critStage = move.meta?.critRate ?? 0;
  const critThresholds = [24, 8, 2, 1]; // stage 0=1/24, 1=1/8, 2=1/2, 3=always
  const critDenominator = critThresholds[Math.min(critStage, 3)];
  const isCritical = Math.random() * critDenominator < 1;

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

  // STAB (Same-Type Attack Bonus): caller-supplied via computeStab.
  // Fallback: infer from attackerTypes (for legacy/PvE call sites that haven't
  // migrated). Keeping this fallback makes the parameter effectively optional.
  const stab = stabMultiplier ?? (attackerTypes.includes(move.type) ? 1.5 : 1.0);

  // Critical hit multiplier
  const critMultiplier = isCritical ? 1.5 : 1.0;

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
