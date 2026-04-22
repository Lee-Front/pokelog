import { getSpeciesByName } from "./data-loader.js";
import type { PrimaryStatus } from "../../../../shared/types.js";

/**
 * Canon status-condition multiplier applied to the wild pokemon's catch roll.
 *  - Sleep / Freeze: 2.5x  (2.0x in Gen VII+; we use the legacy 2.5x for stronger QoL)
 *  - Paralysis / Poison / Burn: 1.5x
 *  - No status: 1.0x
 */
export function getStatusCaptureBonus(status: PrimaryStatus | null | undefined): number {
  if (status === "sleep" || status === "freeze") return 2.5;
  if (status === "paralysis" || status === "poison" || status === "burn") return 1.5;
  return 1.0;
}

export function calculateCaptureChance(
  ballCatchBonus: number,
  currentHp: number,
  maxHp: number,
  baseCatchRate: number,
  statusCondition?: PrimaryStatus | null,
): number {
  if (maxHp <= 0) return Math.min(1.0, baseCatchRate);
  const statusBonus = getStatusCaptureBonus(statusCondition);
  const chance = statusBonus * (ballCatchBonus * (1 - currentHp / maxHp) * 0.5 + baseCatchRate);
  return Math.min(1.0, chance);
}

export function attemptCapture(
  ballCatchBonus: number,
  currentHp: number,
  maxHp: number,
  baseCatchRate: number,
  statusCondition?: PrimaryStatus | null,
): boolean {
  const chance = calculateCaptureChance(ballCatchBonus, currentHp, maxHp, baseCatchRate, statusCondition);
  return Math.random() < chance;
}

export function getCatchRate(species: string): number {
  const data = getSpeciesByName(species);
  return data?.catchRate ?? 0.1;
}
