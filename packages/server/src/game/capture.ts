import { getSpeciesByName } from "./data-loader.js";

export function calculateCaptureChance(
  ballCatchBonus: number,
  currentHp: number,
  maxHp: number,
  baseCatchRate: number,
): number {
  if (maxHp <= 0) return Math.min(1.0, baseCatchRate);
  const chance = ballCatchBonus * (1 - currentHp / maxHp) * 0.5 + baseCatchRate;
  return Math.min(1.0, chance);
}

export function attemptCapture(
  ballCatchBonus: number,
  currentHp: number,
  maxHp: number,
  baseCatchRate: number,
): boolean {
  const chance = calculateCaptureChance(ballCatchBonus, currentHp, maxHp, baseCatchRate);
  return Math.random() < chance;
}

export function getCatchRate(species: string): number {
  const data = getSpeciesByName(species);
  return data?.catchRate ?? 0.1;
}
