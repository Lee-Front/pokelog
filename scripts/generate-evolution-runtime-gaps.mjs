import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const evolutionPath = path.join(repoRoot, "data", "pokemon", "evolution.json");
const auditJsonPath = path.join(repoRoot, "data", "pokemon", "evolution-runtime-gaps.json");
const auditDocPath = path.join(repoRoot, "docs", "pokemon-evolution-runtime-gaps.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function compareBySpecies(left, right) {
  return left.sourceSpecies.localeCompare(right.sourceSpecies)
    || left.targetSpecies.localeCompare(right.targetSpecies)
    || left.branchId.localeCompare(right.branchId);
}

const evolutionData = readJson(evolutionPath);
const SUPPORTED_EXTRA_KEYS = new Set([
  "min_affection",
  "min_beauty",
  "used_move",
  "min_move_count",
  "min_damage_taken",
  "trade_species",
  "needs_overworld_rain",
  "turn_upside_down",
]);

const unsupportedTriggerFamilies = {};
const unsupportedExtraFamilies = {};
let totalBranches = 0;
let unsupportedBranchCount = 0;

for (const [sourceSpecies, entry] of Object.entries(evolutionData)) {
  for (const branch of entry.branches ?? []) {
    totalBranches++;

    for (const condition of branch.conditions ?? []) {
      if (condition.type !== "extra" || SUPPORTED_EXTRA_KEYS.has(condition.key)) {
        continue;
      }

      unsupportedBranchCount++;
      const bucket = unsupportedExtraFamilies[condition.key] ??= [];
      bucket.push({
        sourceSpecies,
        targetSpecies: branch.targetSpecies,
        branchId: branch.id,
      });
    }
  }
}

for (const families of Object.values(unsupportedTriggerFamilies)) {
  families.sort(compareBySpecies);
}
for (const families of Object.values(unsupportedExtraFamilies)) {
  families.sort(compareBySpecies);
}

const generatedAt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const unsupportedTriggersTotal = Object.values(unsupportedTriggerFamilies).reduce(
  (sum, families) => sum + families.length,
  0,
);
const unsupportedExtrasTotal = Object.values(unsupportedExtraFamilies).reduce(
  (sum, families) => sum + families.length,
  0,
);

const auditJson = {
  generatedAt,
  totals: {
    totalBranches,
    unsupportedBranches: unsupportedTriggersTotal + unsupportedExtrasTotal,
    unsupportedTriggerBranches: unsupportedTriggersTotal,
    unsupportedExtraBranches: unsupportedExtrasTotal,
  },
  unsupportedTriggerFamilies,
  unsupportedExtraFamilies,
};

function renderBranchList(entries) {
  return entries.map((entry) => `- \`${entry.sourceSpecies} -> ${entry.targetSpecies}\``).join("\n");
}

const triggerSection = Object.entries(unsupportedTriggerFamilies)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, entries]) => `### \`${key}\` (\`${entries.length}\`)

Current runtime status:

- ${key} branches are explicitly blocked from auto-resolution
- Pokemon detail marks these branches as deferred

Affected branches:

${renderBranchList(entries)}`)
  .join("\n\n");

const extraSection = Object.entries(unsupportedExtraFamilies)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, entries]) => `### \`extra:${key}\` (\`${entries.length}\`)

${renderBranchList(entries)}`)
  .join("\n\n");

const auditDoc = `# Pokemon Evolution Runtime Gaps

Generated: ${generatedAt}

## Purpose

This document lists the evolution branches that are still intentionally unsupported at runtime.

It exists so the project can distinguish:

- branches that are already implemented
- branches that are visible to the player but deferred
- branches that need a future substitute design instead of a literal main-series implementation

## Current Coverage

- Total evolution branches in \`data/pokemon/evolution.json\`: \`${totalBranches}\`
- Branches currently marked unsupported by runtime: \`${unsupportedTriggersTotal + unsupportedExtrasTotal}\`

The unsupported set is currently limited to unsupported \`extra\` condition families.

## Unsupported Trigger Family

${unsupportedTriggersTotal > 0 ? triggerSection : "- none"}

## Unsupported \`extra\` Families

${extraSection || "- none"}

## Practical Design Reading

Not all unsupported branches should be implemented literally.

Reasonable future options:

- \`min_beauty\`
  either add a beauty-like stat or replace it with friendship if the project wants fewer hidden stats
- \`needs_overworld_rain\`
  add a lightweight weather flag or map it to a region/event substitute
- \`turn_upside_down\`
  likely needs a project-specific substitute rather than a literal device-orientation mechanic
- \`min_damage_taken\`
  likely needs battle telemetry or a simpler substitute trigger

## Recommended Next Decisions

1. Decide whether low-frequency one-off conditions should get literal support or curated substitutes.
2. Decide whether beauty, weather, and battle-telemetry substitutes belong in the core progression loop.
3. Decide whether unsupported one-off branches should stay visible as deferred or be hidden until their substitute exists.
`;

fs.mkdirSync(path.dirname(auditJsonPath), { recursive: true });
fs.mkdirSync(path.dirname(auditDocPath), { recursive: true });
fs.writeFileSync(auditJsonPath, `${JSON.stringify(auditJson, null, 2)}\n`);
fs.writeFileSync(auditDocPath, `${auditDoc}\n`);

console.log(`Wrote ${path.relative(repoRoot, auditJsonPath)}`);
console.log(`Wrote ${path.relative(repoRoot, auditDocPath)}`);
