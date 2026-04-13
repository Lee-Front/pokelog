import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const artSplitPath = path.join(repoRoot, "data", "pokemon", "art-species-split.json");
const speciesPath = path.join(repoRoot, "data", "pokemon", "species.json");
const movesPath = path.join(repoRoot, "data", "moves", "moves.json");
const evolutionPath = path.join(repoRoot, "data", "pokemon", "evolution.json");
const scaffoldPath = path.join(repoRoot, "data", "pokemon", "species-scaffold.json");
const scaffoldDocPath = path.join(repoRoot, "docs", "pokemon-species-scaffold.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeLearnset(learnset) {
  if (!learnset) {
    return { levelUp: {}, tm: [], tutor: [], egg: [], event: [] };
  }

  if ("levelUp" in learnset) {
    return {
      levelUp: learnset.levelUp ?? {},
      tm: learnset.tm ?? [],
      tutor: learnset.tutor ?? [],
      egg: learnset.egg ?? [],
      event: learnset.event ?? [],
    };
  }

  return {
    levelUp: learnset,
    tm: [],
    tutor: [],
    egg: [],
    event: [],
  };
}

function collectLearnsetMoveIds(learnset) {
  const normalized = normalizeLearnset(learnset);
  return uniqueSorted([
    ...Object.values(normalized.levelUp).flatMap((moves) => moves),
    ...normalized.tm,
    ...normalized.tutor,
    ...normalized.egg,
    ...normalized.event,
  ]);
}

function previewList(items, max = 30) {
  if (items.length === 0) return "- none";
  const visible = items.slice(0, max).map((item) => `- \`${item}\``);
  if (items.length > max) {
    visible.push(`- ... and ${items.length - max} more`);
  }
  return visible.join("\n");
}

function createEmptySpeciesDraft(species) {
  return {
    id: null,
    species,
    name: null,
    types: [],
    baseStats: {
      hp: null,
      attack: null,
      defense: null,
      spAttack: null,
      spDefense: null,
      speed: null,
    },
    catchRate: null,
    expGroup: null,
    learnset: {
      levelUp: {},
      tm: [],
      tutor: [],
      egg: [],
      event: [],
    },
    maxMoves: 4,
  };
}

const artSplit = readJson(artSplitPath);
const speciesData = readJson(speciesPath);
const movesData = readJson(movesPath);
const evolutionData = readJson(evolutionPath);

const moveIdSet = new Set(movesData.map((move) => move.id));
const speciesMap = new Map(speciesData.map((entry) => [entry.species, entry]));
const baseSpeciesSlugs = artSplit.baseSpeciesSlugs;

const entries = baseSpeciesSlugs.map((species) => {
  const currentSpecies = speciesMap.get(species) ?? null;
  const evolutionEntry = evolutionData[species] ?? null;
  const normalizedDraft = currentSpecies
    ? { ...currentSpecies, learnset: normalizeLearnset(currentSpecies.learnset) }
    : createEmptySpeciesDraft(species);
  const learnsetMoveIds = currentSpecies ? collectLearnsetMoveIds(currentSpecies.learnset) : [];
  const missingMoveIds = learnsetMoveIds.filter((moveId) => !moveIdSet.has(moveId));

  return {
    species,
    status: currentSpecies ? "complete" : "missing",
    coverage: {
      hasSpeciesData: Boolean(currentSpecies),
      hasEvolutionEntry: Boolean(evolutionEntry),
      learnsetMoveCount: learnsetMoveIds.length,
      missingMoveIds,
    },
    draft: normalizedDraft,
  };
});

const completeEntries = entries.filter((entry) => entry.status === "complete");
const missingEntries = entries.filter((entry) => entry.status === "missing");
const missingEvolutionEntries = entries.filter((entry) => !entry.coverage.hasEvolutionEntry);
const entriesWithMissingMoves = entries.filter((entry) => entry.coverage.missingMoveIds.length > 0);

const scaffold = {
  generatedAt: new Date().toISOString(),
  summary: {
    baseSpeciesCount: entries.length,
    completedSpeciesCount: completeEntries.length,
    missingSpeciesCount: missingEntries.length,
    speciesCoveragePercent: Number(((completeEntries.length / entries.length) * 100).toFixed(2)),
    evolutionEntryCount: entries.length - missingEvolutionEntries.length,
    missingEvolutionEntryCount: missingEvolutionEntries.length,
    entriesWithMissingMovesCount: entriesWithMissingMoves.length,
  },
  entries,
};

const doc = `# Pokemon Species Scaffold

Generated: ${scaffold.generatedAt}

## Summary

- Base species workset size: ${entries.length}
- Completed species entries already in \`data/pokemon/species.json\`: ${completeEntries.length}
- Missing species entries to research and fill: ${missingEntries.length}
- Species coverage against base art list: ${scaffold.summary.speciesCoveragePercent}%
- Base species without evolution entry yet: ${missingEvolutionEntries.length}
- Species entries with learnset moves missing from \`moves.json\`: ${entriesWithMissingMoves.length}

## What This File Is

- \`data/pokemon/species-scaffold.json\` is a work file, not runtime data.
- Every base species slug from \`art-species-split.json\` gets one row.
- Existing species data is copied through as-is.
- Missing species get a schema-shaped draft with \`null\` placeholders so research can be filled in safely.

## Missing Species Preview

${previewList(missingEntries.map((entry) => entry.species), 40)}

## Missing Evolution Entry Preview

${previewList(missingEvolutionEntries.map((entry) => entry.species), 20)}

## Workflow

1. Pick a batch of species from the missing list.
2. Fill the corresponding \`draft\` objects in \`species-scaffold.json\`.
3. Add required moves to \`data/moves/moves.json\`.
4. Add or confirm evolution entries in \`data/pokemon/evolution.json\`.
5. Once a batch is complete, copy validated entries into runtime \`species.json\`.
`;

fs.mkdirSync(path.dirname(scaffoldPath), { recursive: true });
fs.mkdirSync(path.dirname(scaffoldDocPath), { recursive: true });
fs.writeFileSync(scaffoldPath, `${JSON.stringify(scaffold, null, 2)}\n`);
fs.writeFileSync(scaffoldDocPath, `${doc}\n`);

console.log(`Wrote ${path.relative(repoRoot, scaffoldPath)}`);
console.log(`Wrote ${path.relative(repoRoot, scaffoldDocPath)}`);
console.log(`Completed species entries: ${completeEntries.length}`);
console.log(`Missing species entries: ${missingEntries.length}`);
