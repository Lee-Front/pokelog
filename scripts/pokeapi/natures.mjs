import { fetchJson } from "./fetch.mjs";
import { mapNatureStat, mapWithConcurrency, pickLocalizedName, projectPath, writeJsonFile } from "./common.mjs";

export async function syncNatures(options = {}) {
  const list = await fetchJson("/nature?limit=25", {
    cacheKey: ["index", "nature-list.json"],
    noCache: options.noCache,
    fetchImpl: options.fetchImpl,
  });

  const details = await mapWithConcurrency(
    list.results,
    (entry) => fetchJson(entry.url, {
      cacheKey: ["nature", `${entry.name}.json`],
      noCache: options.noCache,
      fetchImpl: options.fetchImpl,
    }),
    options.concurrency ?? 10,
  );

  const data = details
    .map((nature) => ({
      id: nature.name,
      name: pickLocalizedName(nature.names, nature.name),
      increasedStat: mapNatureStat(nature.increased_stat?.name ?? null),
      decreasedStat: mapNatureStat(nature.decreased_stat?.name ?? null),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!options.dryRun) {
    await writeJsonFile(projectPath("data", "natures", "natures.json"), data);
  }

  return data;
}
