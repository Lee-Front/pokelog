import { fetchJson } from "./fetch.mjs";
import {
  compareBySlot,
  mapStatName,
  mapWithConcurrency,
  projectPath,
  readJsonFile,
  writeJsonFile,
} from "./common.mjs";

const ELIGIBLE_KINDS = new Set(["regional", "permanent-form", "battle-form"]);
const STAT_KEYS = ["hp", "attack", "defense", "spAttack", "spDefense", "speed"];

function normalizeTypes(types) {
  return [...(types ?? [])]
    .sort(compareBySlot)
    .map((entry) => entry.type?.name)
    .filter(Boolean);
}

function normalizeBaseStats(stats) {
  const entries = Object.fromEntries(
    (stats ?? []).map((entry) => [mapStatName(entry.stat?.name ?? ""), entry.base_stat ?? 0]),
  );

  return {
    hp: entries.hp ?? 0,
    attack: entries.attack ?? 0,
    defense: entries.defense ?? 0,
    spAttack: entries.spAttack ?? 0,
    spDefense: entries.spDefense ?? 0,
    speed: entries.speed ?? 0,
  };
}

function buildBaseStatsOverride(variantStats, baseSpeciesStats) {
  if (!baseSpeciesStats) return variantStats;

  const override = {};
  for (const key of STAT_KEYS) {
    if (variantStats[key] !== baseSpeciesStats[key]) {
      override[key] = variantStats[key];
    }
  }

  return Object.keys(override).length > 0 ? override : undefined;
}

export async function syncVariants(options = {}) {
  const allVariants = await readJsonFile(
    projectPath("data", "pokemon", "variants.json"),
    [],
  );

  const speciesList = await readJsonFile(
    projectPath("data", "pokemon", "species.json"),
    [],
  );

  const speciesBySlug = Object.fromEntries(
    speciesList.map((entry) => [entry.species, entry]),
  );

  const eligible = allVariants.filter((v) => ELIGIBLE_KINDS.has(v.kind));
  const total = eligible.length;

  await mapWithConcurrency(
    eligible,
    async (variant, index) => {
      const slug = variant.sourceArtSlug;
      console.log(`[${index + 1}/${total}] ${variant.id}`);

      let pokemon;
      try {
        pokemon = await fetchJson(`/pokemon/${slug}`, {
          cacheKey: ["pokemon", `${slug}.json`],
          noCache: options.noCache,
          fetchImpl: options.fetchImpl,
        });
      } catch (err) {
        if (err.message?.includes("404")) {
          console.log(`  ⤷ skipped (not found on PokeAPI)`);
          return;
        }
        throw err;
      }

      const types = normalizeTypes(pokemon.types);
      const fullStats = normalizeBaseStats(pokemon.stats);
      const baseSpecies = speciesBySlug[variant.baseSpecies];
      const baseStatsOverride = buildBaseStatsOverride(fullStats, baseSpecies?.baseStats);

      variant.typing = types;
      if (baseStatsOverride) {
        variant.baseStatsOverride = baseStatsOverride;
      }
    },
    options.concurrency ?? 10,
  );

  const sorted = allVariants.sort((left, right) => left.id.localeCompare(right.id));

  if (!options.dryRun) {
    await writeJsonFile(projectPath("data", "pokemon", "variants.json"), sorted);
  }

  return sorted;
}
