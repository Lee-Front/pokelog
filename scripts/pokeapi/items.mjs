import { fetchJson } from "./fetch.mjs";
import { mapWithConcurrency, pickLocalizedFlavorText, pickLocalizedName, projectPath, writeJsonFile } from "./common.mjs";

const INCLUDED_ITEM_CATEGORIES = new Set([
  "evolution",
  "healing",
  "standard-balls",
  "special-balls",
  "held-items",
  "stat-boosts",
]);

export async function syncItems(options = {}) {
  const list = await fetchJson("/item?limit=2000", {
    cacheKey: ["index", "item-list.json"],
    noCache: options.noCache,
    fetchImpl: options.fetchImpl,
  });

  const details = await mapWithConcurrency(
    list.results,
    (entry) => fetchJson(entry.url, {
      cacheKey: ["item", `${entry.name}.json`],
      noCache: options.noCache,
      fetchImpl: options.fetchImpl,
    }),
    options.concurrency ?? 10,
  );

  const data = details
    .filter((item) => INCLUDED_ITEM_CATEGORIES.has(item.category?.name))
    .map((item) => ({
      id: item.name,
      name: pickLocalizedName(item.names, item.name),
      category: item.category?.name ?? "unknown",
      cost: item.cost ?? 0,
      shortEffect: pickLocalizedFlavorText(item.flavor_text_entries, ""),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (!options.dryRun) {
    await writeJsonFile(projectPath("data", "items", "items.json"), data);
  }

  return data;
}
