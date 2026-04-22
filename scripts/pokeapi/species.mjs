import { fetchJson } from "./fetch.mjs";
import {
  LEARNSET_VERSION_GROUP_PRIORITY,
  compareBySlot,
  mapStatName,
  mapWithConcurrency,
  pickLocalizedName,
  projectPath,
  readJsonFile,
  uniqueSorted,
  writeJsonFile,
} from "./common.mjs";

function createLearnsetBucket() {
  return { levelUp: {}, tm: [], tutor: [], egg: [], event: [] };
}

function chooseVersionDetail(details) {
  const byPriority = [...details].sort((left, right) => {
    const leftRank = LEARNSET_VERSION_GROUP_PRIORITY.indexOf(left.version_group.name);
    const rightRank = LEARNSET_VERSION_GROUP_PRIORITY.indexOf(right.version_group.name);
    const safeLeft = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
    const safeRight = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
    return safeLeft - safeRight;
  });

  return byPriority[0] ?? null;
}

function normalizeLearnset(moves) {
  const learnset = createLearnsetBucket();

  for (const moveEntry of moves ?? []) {
    const selected = chooseVersionDetail(moveEntry.version_group_details ?? []);
    if (!selected) continue;

    const moveId = moveEntry.move?.name;
    if (!moveId) continue;

    switch (selected.move_learn_method?.name) {
      case "level-up": {
        const level = String(selected.level_learned_at ?? 1);
        learnset.levelUp[level] = uniqueSorted([...(learnset.levelUp[level] ?? []), moveId]);
        break;
      }
      case "machine":
        learnset.tm.push(moveId);
        break;
      case "tutor":
        learnset.tutor.push(moveId);
        break;
      case "egg":
        learnset.egg.push(moveId);
        break;
      default:
        learnset.event.push(moveId);
        break;
    }
  }

  return {
    levelUp: Object.fromEntries(
      Object.entries(learnset.levelUp).sort((left, right) => Number(left[0]) - Number(right[0])),
    ),
    tm: uniqueSorted(learnset.tm),
    tutor: uniqueSorted(learnset.tutor),
    egg: uniqueSorted(learnset.egg),
    event: uniqueSorted(learnset.event),
  };
}

function normalizeAbilities(abilities) {
  const sorted = [...(abilities ?? [])].sort(compareBySlot);
  const normal = [];
  let hidden;

  for (const ability of sorted) {
    const abilityId = ability.ability?.name;
    if (!abilityId) continue;
    if (ability.is_hidden) {
      hidden = abilityId;
    } else {
      normal.push(abilityId);
    }
  }

  return {
    normal,
    ...(hidden ? { hidden } : {}),
  };
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

export async function syncSpecies(options = {}) {
  const speciesSlugs = options.speciesSlugs ?? [];
  const pokemonEndpointAliases = await readJsonFile(
    projectPath("data", "pokemon", "pokeapi-species-aliases.json"),
    {},
  );
  const speciesEndpointAliases = await readJsonFile(
    projectPath("data", "pokemon", "pokeapi-pokemon-species-aliases.json"),
    {},
  );

  const data = await mapWithConcurrency(
    speciesSlugs,
    async (slug) => {
      const pokemonSlug = pokemonEndpointAliases[slug] ?? slug;
      const speciesSlug = speciesEndpointAliases[slug] ?? slug;
      const [pokemon, species] = await Promise.all([
        fetchJson(`/pokemon/${pokemonSlug}`, {
          cacheKey: ["pokemon", `${pokemonSlug}.json`],
          noCache: options.noCache,
          fetchImpl: options.fetchImpl,
        }),
        fetchJson(`/pokemon-species/${speciesSlug}`, {
          cacheKey: ["pokemon-species", `${speciesSlug}.json`],
          noCache: options.noCache,
          fetchImpl: options.fetchImpl,
        }),
      ]);

      const rawCaptureRate = species.capture_rate ?? 0;

      return {
        id: pokemon.id,
        species: pokemon.name,
        name: pickLocalizedName(species.names, pokemon.name),
        types: [...(pokemon.types ?? [])].sort(compareBySlot).map((entry) => entry.type?.name).filter(Boolean),
        baseStats: normalizeBaseStats(pokemon.stats),
        catchRate: rawCaptureRate / 255,
        rawCaptureRate,
        expGroup: species.growth_rate?.name ?? "medium",
        baseExpYield: pokemon.base_experience ?? 0,
        weight: pokemon.weight ?? 0, // in hectograms (PokeAPI format)
        learnset: normalizeLearnset(pokemon.moves),
        maxMoves: 4,
        abilities: normalizeAbilities(pokemon.abilities),
        eggGroups: (species.egg_groups ?? []).map((entry) => entry.name),
        genderRate: species.gender_rate ?? -1,
        baseHappiness: species.base_happiness ?? 70,
        isBaby: species.is_baby === true,
        isLegendary: species.is_legendary === true,
        isMythical: species.is_mythical === true,
      };
    },
    options.concurrency ?? 10,
  );

  const sorted = data.sort((left, right) => left.id - right.id);

  if (!options.dryRun) {
    await writeJsonFile(projectPath("data", "pokemon", "species.json"), sorted);
  }

  return sorted;
}
