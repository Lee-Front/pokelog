import { getTypeChart } from "./data-loader.js";
import type { PokemonStats, MoveData, StatStages } from "../../../../shared/types.js";

export function defaultStatStages(): StatStages {
  return { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
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
): DamageResult {
  const typeChart = getTypeChart();

  // Accuracy check
  const accuracyRoll = Math.random() * 100;
  if (accuracyRoll >= move.accuracy) {
    return { damage: 0, missed: true, effectiveness: 1, message: "공격이 빗나갔다!" };
  }

  // Status moves (power 0): skip damage
  if (move.power === 0) {
    return { damage: 0, missed: false, effectiveness: 1, message: "" };
  }

  // Determine atk/def based on category, applying stat stages
  const isPhysical = move.category === "physical";
  const baseAtk = isPhysical ? attackerStats.attack : attackerStats.spAttack;
  const baseDef = isPhysical ? defenderStats.defense : defenderStats.spDefense;
  const atkStage = attackerStages ? (isPhysical ? attackerStages.attack : attackerStages.spAttack) : 0;
  const defStage = defenderStages ? (isPhysical ? defenderStages.defense : defenderStages.spDefense) : 0;
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
    return { damage: 0, missed: false, effectiveness: 0, message };
  }

  // STAB (Same-Type Attack Bonus)
  const stab = attackerTypes.includes(move.type) ? 1.5 : 1.0;

  // Random factor
  const randomFactor = 0.85 + Math.random() * 0.15;

  // Damage formula
  const level = attackerLevel;
  const damage = Math.floor(
    (((2 * level / 5 + 2) * move.power * atk / def) / 50 + 2)
    * stab
    * typeMultiplier
    * weatherModifier
    * randomFactor,
  );

  return { damage, missed: false, effectiveness: typeMultiplier, message };
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
