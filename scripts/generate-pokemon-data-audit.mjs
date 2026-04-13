import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const regularArtDir = path.join(repoRoot, "data", "colorscripts", "small", "regular");
const shinyArtDir = path.join(repoRoot, "data", "colorscripts", "small", "shiny");
const speciesPath = path.join(repoRoot, "data", "pokemon", "species.json");
const movesPath = path.join(repoRoot, "data", "moves", "moves.json");
const evolutionPath = path.join(repoRoot, "data", "pokemon", "evolution.json");
const artIndexPath = path.join(repoRoot, "data", "pokemon", "art-species-index.json");
const auditDocPath = path.join(repoRoot, "docs", "pokemon-data-audit.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listArtSlugs(dirPath) {
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
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
    ...Object.values(normalized.levelUp).flatMap((levelMoves) => levelMoves),
    ...normalized.tm,
    ...normalized.tutor,
    ...normalized.egg,
    ...normalized.event,
  ]);
}

function diff(left, rightSet) {
  return left.filter((value) => !rightSet.has(value));
}

function intersection(left, rightSet) {
  return left.filter((value) => rightSet.has(value));
}

function percent(part, total) {
  if (total === 0) return "0.00";
  return ((part / total) * 100).toFixed(2);
}

function previewList(items, max = 30) {
  if (items.length === 0) return "- none";
  const visible = items.slice(0, max).map((item) => `- \`${item}\``);
  if (items.length > max) {
    visible.push(`- ... and ${items.length - max} more`);
  }
  return visible.join("\n");
}

const regularArtSlugs = listArtSlugs(regularArtDir);
const shinyArtSlugs = listArtSlugs(shinyArtDir);
const speciesData = readJson(speciesPath);
const movesData = readJson(movesPath);
const evolutionData = readJson(evolutionPath);

function collectEvolutionTargets(evolutionEntry) {
  if (!evolutionEntry) return [];
  if (Array.isArray(evolutionEntry.branches)) {
    return evolutionEntry.branches
      .map((branch) => branch?.targetSpecies)
      .filter((value) => typeof value === "string" && value.length > 0);
  }

  return typeof evolutionEntry.evolvesTo === "string" && evolutionEntry.evolvesTo.length > 0
    ? [evolutionEntry.evolvesTo]
    : [];
}

const speciesSlugs = uniqueSorted(speciesData.map((entry) => entry.species));
const moveIds = uniqueSorted(movesData.map((entry) => entry.id));
const evolutionSources = uniqueSorted(Object.keys(evolutionData));
const evolutionTargets = uniqueSorted(
  Object.values(evolutionData).flatMap((entry) => collectEvolutionTargets(entry)),
);

const regularArtSet = new Set(regularArtSlugs);
const shinyArtSet = new Set(shinyArtSlugs);
const speciesSet = new Set(speciesSlugs);
const moveSet = new Set(moveIds);
const evolutionSourceSet = new Set(evolutionSources);

const speciesCoveredByArt = intersection(speciesSlugs, regularArtSet);
const speciesMissingArt = diff(speciesSlugs, regularArtSet);
const artMissingSpeciesData = diff(regularArtSlugs, speciesSet);
const shinyMissingRegular = diff(shinyArtSlugs, regularArtSet);
const regularMissingShiny = diff(regularArtSlugs, shinyArtSet);
const speciesMissingEvolutionEntry = diff(speciesSlugs, evolutionSourceSet);

const learnsetMoveRefs = uniqueSorted(speciesData.flatMap((species) => collectLearnsetMoveIds(species.learnset)));
const learnsetMoveRefsMissingData = diff(learnsetMoveRefs, moveSet);
const evolutionSourcesMissingSpeciesData = diff(evolutionSources, speciesSet);
const evolutionTargetsMissingSpeciesData = diff(evolutionTargets, speciesSet);

const auditIndex = {
  generatedAt: new Date().toISOString(),
  art: {
    regularCount: regularArtSlugs.length,
    shinyCount: shinyArtSlugs.length,
    regularSlugs: regularArtSlugs,
    shinySlugs: shinyArtSlugs,
    regularMissingShiny,
    shinyMissingRegular,
  },
  currentData: {
    speciesCount: speciesSlugs.length,
    moveCount: moveIds.length,
    evolutionEntryCount: evolutionSources.length,
    speciesSlugs,
    moveIds,
    evolutionSources,
    evolutionTargets,
  },
  coverage: {
    artCoveredBySpeciesCount: speciesCoveredByArt.length,
    artMissingSpeciesDataCount: artMissingSpeciesData.length,
    artCoveragePercent: Number(percent(speciesCoveredByArt.length, regularArtSlugs.length)),
    speciesMissingArtCount: speciesMissingArt.length,
    speciesMissingEvolutionEntryCount: speciesMissingEvolutionEntry.length,
    learnsetReferencedMoveCount: learnsetMoveRefs.length,
    learnsetMissingMoveDataCount: learnsetMoveRefsMissingData.length,
  },
  missing: {
    artMissingSpeciesData,
    speciesMissingArt,
    speciesMissingEvolutionEntry,
    learnsetMoveRefsMissingData,
    evolutionSourcesMissingSpeciesData,
    evolutionTargetsMissingSpeciesData,
  },
};

const auditDoc = `# Pokemon Data Audit

Generated: ${auditIndex.generatedAt}

## Summary

- Regular ANSI art slugs: ${regularArtSlugs.length}
- Shiny ANSI art slugs: ${shinyArtSlugs.length}
- Species entries in \`data/pokemon/species.json\`: ${speciesSlugs.length}
- Move entries in \`data/moves/moves.json\`: ${moveIds.length}
- Evolution entries in \`data/pokemon/evolution.json\`: ${evolutionSources.length}
- Regular art coverage by species data: ${speciesCoveredByArt.length}/${regularArtSlugs.length} (${percent(speciesCoveredByArt.length, regularArtSlugs.length)}%)

## Current Gaps

- Regular art slugs missing from species data: ${artMissingSpeciesData.length}
- Species entries without matching regular art: ${speciesMissingArt.length}
- Species entries without an evolution entry: ${speciesMissingEvolutionEntry.length}
- Learnset move ids missing from move data: ${learnsetMoveRefsMissingData.length}
- Evolution sources missing from species data: ${evolutionSourcesMissingSpeciesData.length}
- Evolution targets missing from species data: ${evolutionTargetsMissingSpeciesData.length}

## Notes

- The art inventory is based on raw slug filenames in \`data/colorscripts/small/regular\`.
- Raw art slugs include alternate forms, megas, regional variants, gmax forms, and other special cases.
- The current species schema is still a starter dataset, so the art count is a better proxy for total scope than the current \`species.json\`.

## Missing Species Data Preview

${previewList(artMissingSpeciesData, 40)}

## Species Missing Evolution Entry Preview

${previewList(speciesMissingEvolutionEntry, 20)}

## Missing Learnset Move Data Preview

${previewList(learnsetMoveRefsMissingData, 20)}

## Recommended Next Steps

1. Expand \`species.json\` to cover every regular art slug that should be encounterable.
2. Split raw slug coverage into base species versus special forms so region pools and egg pools can be balanced cleanly.
3. Expand \`EvolutionData\` beyond single-target level evolutions to support item, branch, trade, friendship, move-known, and regional conditions.
4. Expand \`MoveData\` and battle logic to support status moves and move effects, not just power-based damage.
5. Replace hard-coded egg pools with a data-driven pool that references audited species coverage.
`;

fs.mkdirSync(path.dirname(artIndexPath), { recursive: true });
fs.mkdirSync(path.dirname(auditDocPath), { recursive: true });
fs.writeFileSync(artIndexPath, `${JSON.stringify(auditIndex, null, 2)}\n`);
fs.writeFileSync(auditDocPath, `${auditDoc}\n`);

console.log(`Wrote ${path.relative(repoRoot, artIndexPath)}`);
console.log(`Wrote ${path.relative(repoRoot, auditDocPath)}`);
