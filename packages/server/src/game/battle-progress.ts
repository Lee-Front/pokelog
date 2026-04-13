import type { OwnedPokemon } from "../../../../shared/types.js";

export function normalizeDamageTakenTotal(value: number | null | undefined): number {
  return Math.max(0, Number(value) || 0);
}

export function getDamageTakenTotal(value: number | null | undefined): number {
  return normalizeDamageTakenTotal(value);
}

export function recordDamageTaken(
  pokemon: OwnedPokemon,
  amount: number,
): number {
  const current = normalizeDamageTakenTotal(pokemon.damageTakenTotal);
  const next = current + Math.max(0, Math.floor(amount));
  pokemon.damageTakenTotal = next;
  return next;
}
