import { fetchJson } from "./fetch.mjs";
import { mapWithConcurrency, pickLocalizedFlavorText, pickLocalizedName, projectPath, writeJsonFile } from "./common.mjs";

export async function syncAbilities(options = {}) {
  const list = await fetchJson("/ability?limit=400", {
    cacheKey: ["index", "ability-list.json"],
    noCache: options.noCache,
    fetchImpl: options.fetchImpl,
  });

  const details = await mapWithConcurrency(
    list.results,
    (entry) => fetchJson(entry.url, {
      cacheKey: ["ability", `${entry.name}.json`],
      noCache: options.noCache,
      fetchImpl: options.fetchImpl,
    }),
    options.concurrency ?? 10,
  );

  const data = details
    .map((ability) => ({
      id: ability.name,
      name: pickLocalizedName(ability.names, ability.name),
      shortEffect: pickLocalizedFlavorText(ability.flavor_text_entries, ""),
      isMainSeries: ability.is_main_series === true,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!options.dryRun) {
    await writeJsonFile(projectPath("data", "abilities", "abilities.json"), data);
  }

  return data;
}
