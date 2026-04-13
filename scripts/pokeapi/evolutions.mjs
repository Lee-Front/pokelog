import { fetchJson } from "./fetch.mjs";
import { mapWithConcurrency, projectPath, uniqueSorted, writeJsonFile } from "./common.mjs";

function mapTrigger(name) {
  switch (name) {
    case "level-up":
      return "level-up";
    case "use-item":
      return "use-item";
    case "trade":
      return "trade";
    default:
      return "other";
  }
}

function buildConditions(detail) {
  const conditions = [];

  if (detail.min_level) conditions.push({ type: "level", level: detail.min_level });
  if (detail.item?.name) conditions.push({ type: "item-use", item: detail.item.name });
  if (detail.held_item?.name) conditions.push({ type: "held-item", item: detail.held_item.name });
  if (detail.min_happiness) conditions.push({ type: "friendship", min: detail.min_happiness });
  if (detail.time_of_day === "day" || detail.time_of_day === "night") {
    conditions.push({ type: "time", value: detail.time_of_day });
  }
  if (detail.known_move?.name) conditions.push({ type: "known-move", moveId: detail.known_move.name });
  if (detail.known_move_type?.name) conditions.push({ type: "known-move-type", moveType: detail.known_move_type.name });
  if (detail.location?.name) conditions.push({ type: "location", location: detail.location.name });
  if (detail.gender === 1) conditions.push({ type: "gender", value: "female" });
  if (detail.gender === 2) conditions.push({ type: "gender", value: "male" });
  if (detail.party_species?.name) conditions.push({ type: "party-member", species: detail.party_species.name });
  if (detail.party_type?.name) conditions.push({ type: "party-member", pokemonType: detail.party_type.name });

  if (detail.relative_physical_stats === 1) {
    conditions.push({ type: "stat-compare", stat: "attack-vs-defense", op: "gt" });
  } else if (detail.relative_physical_stats === -1) {
    conditions.push({ type: "stat-compare", stat: "attack-vs-defense", op: "lt" });
  } else if (detail.relative_physical_stats === 0) {
    conditions.push({ type: "stat-compare", stat: "attack-vs-defense", op: "eq" });
  }

  return conditions;
}

function appendExtraConditions(detail, conditions) {
  const handledKeys = new Set([
    "min_level",
    "item",
    "held_item",
    "min_happiness",
    "time_of_day",
    "known_move",
    "known_move_type",
    "location",
    "gender",
    "party_species",
    "party_type",
    "relative_physical_stats",
    "trigger",
  ]);

  for (const [key, value] of Object.entries(detail)) {
    if (handledKeys.has(key)) continue;
    if (value == null || value === "" || value === false) continue;
    conditions.push({ type: "extra", key, value });
  }
}

function walkEvolutionNode(node, record) {
  const sourceSpecies = node.species?.name;
  if (!sourceSpecies) {
    return;
  }

  record[sourceSpecies] ??= { branches: [] };

  for (const child of node.evolves_to ?? []) {
    const targetSpecies = child.species?.name;
    if (!targetSpecies) continue;

    const details = child.evolution_details?.length
      ? child.evolution_details
      : [{ trigger: { name: "other" } }];

    details.forEach((detail, index) => {
      const conditions = buildConditions(detail);
      appendExtraConditions(detail, conditions);

      record[sourceSpecies].branches.push({
        id: `${sourceSpecies}-${targetSpecies}-${index + 1}`,
        targetSpecies,
        trigger: mapTrigger(detail.trigger?.name),
        conditions,
        consumeItem: detail.item?.name ?? null,
      });
    });

    walkEvolutionNode(child, record);
  }
}

export async function syncEvolutions(options = {}) {
  const list = await fetchJson("/evolution-chain?limit=500", {
    cacheKey: ["index", "evolution-chain-list.json"],
    noCache: options.noCache,
    fetchImpl: options.fetchImpl,
  });

  const chains = await mapWithConcurrency(
    list.results,
    (entry) => fetchJson(entry.url, {
      cacheKey: ["evolution-chain", `${entry.name ?? entry.url.split("/").filter(Boolean).pop()}.json`],
      noCache: options.noCache,
      fetchImpl: options.fetchImpl,
    }),
    options.concurrency ?? 10,
  );

  const record = {};
  for (const chain of chains) {
    walkEvolutionNode(chain.chain, record);
  }

  const limitedRecord = options.speciesSlugs?.length
    ? Object.fromEntries(
      uniqueSorted(options.speciesSlugs)
        .map((slug) => [slug, record[slug] ?? { branches: [] }]),
    )
    : record;

  if (!options.dryRun) {
    await writeJsonFile(projectPath("data", "pokemon", "evolution.json"), limitedRecord);
  }

  return limitedRecord;
}
