import { fetchJson } from "./fetch.mjs";
import {
  mapStatName,
  mapWithConcurrency,
  pickLocalizedFlavorText,
  pickLocalizedName,
  projectPath,
  writeJsonFile,
} from "./common.mjs";

function mapMoveMeta(meta) {
  return {
    ailment: meta?.ailment?.name,
    ailmentChance: meta?.ailment_chance ?? 0,
    critRate: meta?.crit_rate ?? 0,
    drain: meta?.drain ?? 0,
    flinchChance: meta?.flinch_chance ?? 0,
    healing: meta?.healing ?? 0,
    statChance: meta?.stat_chance ?? 0,
    minHits: meta?.min_hits ?? undefined,
    maxHits: meta?.max_hits ?? undefined,
  };
}

export async function syncMoves(options = {}) {
  const list = await fetchJson("/move?limit=2000", {
    cacheKey: ["index", "move-list.json"],
    noCache: options.noCache,
    fetchImpl: options.fetchImpl,
  });

  const details = await mapWithConcurrency(
    list.results,
    (entry) => fetchJson(entry.url, {
      cacheKey: ["move", `${entry.name}.json`],
      noCache: options.noCache,
      fetchImpl: options.fetchImpl,
    }),
    options.concurrency ?? 10,
  );

  const filtered = details.filter((move) => {
    // Skip Z-move variants (e.g., acid-downpour--physical)
    if (move.name.includes("--")) return false;
    // Skip shadow moves (Colosseum/XD, pp === 0)
    if (move.pp === 0 || move.pp === null) return false;
    return true;
  });

  const data = filtered
    .map((move) => ({
      id: move.name,
      name: pickLocalizedName(move.names, move.name),
      type: move.type?.name ?? "normal",
      category: move.damage_class?.name ?? "status",
      power: move.power ?? 0,
      accuracy: move.accuracy ?? 0,
      pp: move.pp ?? 0,
      description: pickLocalizedFlavorText(move.flavor_text_entries, ""),
      priority: move.priority ?? 0,
      target: move.target?.name ?? "selected-pokemon",
      meta: mapMoveMeta(move.meta),
      statChanges: (move.stat_changes ?? []).map((change) => ({
        stat: mapStatName(change.stat?.name ?? ""),
        change: change.change ?? 0,
      })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!options.dryRun) {
    await writeJsonFile(projectPath("data", "moves", "moves.json"), data);
  }

  return data;
}
