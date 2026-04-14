import { syncAbilities } from "./pokeapi/abilities.mjs";
import { syncEvolutions } from "./pokeapi/evolutions.mjs";
import { syncItems } from "./pokeapi/items.mjs";
import { syncMoves } from "./pokeapi/moves.mjs";
import { syncNatures } from "./pokeapi/natures.mjs";
import { readJsonFile, projectPath } from "./pokeapi/common.mjs";
import { syncSpecies } from "./pokeapi/species.mjs";
import { syncVariants } from "./pokeapi/variants.mjs";

const TASKS = ["natures", "abilities", "items", "moves", "species", "evolutions", "variants"];

function parseArgs(argv) {
  const args = {
    only: null,
    noCache: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--only") {
      args.only = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (value === "--no-cache") {
      args.noCache = true;
      continue;
    }
    if (value === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function printSection(title, position, total) {
  console.log(`=== ${title} (${position}/${total}) ===`);
}

async function loadBaseSpeciesSlugs() {
  const artSplit = await readJsonFile(projectPath("data", "pokemon", "art-species-split.json"), {
    baseSpeciesSlugs: [],
  });

  return artSplit.baseSpeciesSlugs ?? [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseSpeciesSlugs = await loadBaseSpeciesSlugs();

  const runners = {
    natures: () => syncNatures(args),
    abilities: () => syncAbilities(args),
    items: () => syncItems(args),
    moves: () => syncMoves(args),
    species: () => syncSpecies({ ...args, speciesSlugs: baseSpeciesSlugs }),
    evolutions: () => syncEvolutions({ ...args, speciesSlugs: baseSpeciesSlugs }),
    variants: () => syncVariants(args),
  };

  const selectedTasks = args.only ? TASKS.filter((task) => task === args.only) : TASKS;
  if (selectedTasks.length === 0) {
    throw new Error(`Unknown sync target: ${args.only}`);
  }

  for (const [index, task] of selectedTasks.entries()) {
    printSection(task, index + 1, selectedTasks.length);
    const result = await runners[task]();

    if (Array.isArray(result)) {
      console.log(`${task}: ${result.length} records`);
    } else {
      console.log(`${task}: ${Object.keys(result).length} records`);
    }
  }

  if (args.dryRun) {
    console.log("dry-run complete");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
