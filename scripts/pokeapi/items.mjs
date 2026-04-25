import { fetchJson } from "./fetch.mjs";
import { mapWithConcurrency, pickLocalizedFlavorText, pickLocalizedName, projectPath, writeJsonFile } from "./common.mjs";

// Excludes categories that are flavor/region-specific clutter. Everything else
// — TMs, status cures, revives, vitamins, etc. — flows into the dataset so the
// in-game item registry can decide what to surface.
const EXCLUDED_ITEM_CATEGORIES = new Set([
  "dynamax-crystals",   // Sword/Shield Max Raid tickets
  "tm-materials",       // Gen 9 TM crafting raw materials
  "unused",             // explicitly unused
  "all-mail",           // mail items
  "sandwich-ingredients", "curry-ingredients", "picnic", "baking-only", // cooking
  "data-cards",         // Gen 9 SV-specific
  "miracle-shooter",    // Pokemon Pinball
  "spelunking",         // Legends Arceus specific
  "event-items",        // one-off event distributions
  "mulch",              // gardening
  "apricorn-box",       // container, not a ball
  "dex-completion",     // single utility (poke-radar, etc.)
  "flutes",             // RSE specific
  "species-candies",    // Gen 9 SV LA candies
  "loot",               // sellable junk
  "picky-healing",      // Gen 8 odd category
  "other",
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
    .filter((item) => !EXCLUDED_ITEM_CATEGORIES.has(item.category?.name ?? "unknown"))
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
