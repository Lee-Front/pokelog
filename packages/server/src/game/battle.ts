import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PokemonStats, MoveData } from "../../../../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../../..");

type TypeChart = Record<string, Record<string, number>>;

let typeChartCache: TypeChart | null = null;

function loadTypeChart(): TypeChart {
  if (!typeChartCache) {
    const filePath = path.resolve(PROJECT_ROOT, "data/types/type-chart.json");
    typeChartCache = JSON.parse(readFileSync(filePath, "utf-8")) as TypeChart;
  }
  return typeChartCache;
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
): DamageResult {
  const typeChart = loadTypeChart();

  // Accuracy check
  const accuracyRoll = Math.random() * 100;
  if (accuracyRoll >= move.accuracy) {
    return { damage: 0, missed: true, effectiveness: 1, message: "공격이 빗나갔다!" };
  }

  // Status moves (power 0): skip damage
  if (move.power === 0) {
    return { damage: 0, missed: false, effectiveness: 1, message: "" };
  }

  // Determine atk/def based on category
  const isPhysical = move.category === "physical";
  const atk = isPhysical ? attackerStats.attack : attackerStats.spAttack;
  const def = isPhysical ? defenderStats.defense : defenderStats.spDefense;

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

  // Random factor
  const randomFactor = 0.85 + Math.random() * 0.15;

  // Damage formula
  const level = attackerLevel;
  const damage = Math.floor(
    (((2 * level / 5 + 2) * move.power * atk / def) / 50 + 2)
    * typeMultiplier
    * randomFactor,
  );

  return { damage, missed: false, effectiveness: typeMultiplier, message };
}

export function determineTurnOrder(mySpeed: number, wildSpeed: number): "player" | "wild" {
  if (mySpeed > wildSpeed) return "player";
  if (wildSpeed > mySpeed) return "wild";
  return Math.random() < 0.5 ? "player" : "wild";
}

/** Clear caches (useful for testing) */
export function _clearCache(): void {
  typeChartCache = null;
}
