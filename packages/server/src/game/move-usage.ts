import type { OwnedPokemon } from "../../../../shared/types.js";

export function normalizeMoveUsageCounts(
  counts: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!counts || typeof counts !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(counts)
      .filter(([moveId]) => typeof moveId === "string" && moveId.length > 0)
      .map(([moveId, value]) => [moveId, Math.max(0, Number(value) || 0)]),
  );
}

export function getMoveUsageCount(
  counts: Record<string, number> | null | undefined,
  moveId: string,
): number {
  return normalizeMoveUsageCounts(counts)[moveId] ?? 0;
}

export function recordMoveUsage(
  pokemon: OwnedPokemon,
  moveId: string,
  amount: number = 1,
): number {
  const counts = normalizeMoveUsageCounts(pokemon.moveUsageCounts);
  const nextCount = (counts[moveId] ?? 0) + Math.max(1, Math.floor(amount));
  counts[moveId] = nextCount;
  pokemon.moveUsageCounts = counts;
  return nextCount;
}
