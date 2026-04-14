import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const artSplitPath = path.join(repoRoot, "data", "pokemon", "art-species-split.json");
const outputPath = path.join(repoRoot, "data", "pokemon", "variants.json");

const PERMANENT_FORM_CATEGORIES = new Set([
  "alcremie-form",
  "pattern-form",
  "event-form",
  "color-form",
  "trim-form",
  "cap-form",
  "costume-form",
  "seasonal-form",
  "cloak-form",
  "gene-drive",
  "therian",
  "origin",
  "size-form",
  "rotom-appliance",
  "type-form",
  "unown-form",
]);

const BATTLE_FORM_CATEGORIES = new Set([
  "battle-form",
  "gigantamax",
  "mega",
  "primal",
  "rider",
]);

function toDisplayName(slug) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getVariantKind(category) {
  if (category === "regional" || category === "regional-special") {
    return "regional";
  }
  if (BATTLE_FORM_CATEGORIES.has(category)) {
    return "battle-form";
  }
  if (PERMANENT_FORM_CATEGORIES.has(category)) {
    return "permanent-form";
  }
  return "permanent-form";
}

function isEncounterEligible(kind) {
  return kind !== "battle-form";
}

function isEggEligible(kind) {
  return kind === "regional";
}

function main() {
  const artSplit = JSON.parse(fs.readFileSync(artSplitPath, "utf8"));
  const specialForms = Array.isArray(artSplit.specialForms) ? artSplit.specialForms : [];

  const variants = specialForms
    .map((entry) => {
      const kind = getVariantKind(entry.category);
      return {
        id: entry.slug,
        baseSpecies: entry.rootBaseSlug,
        kind,
        name: toDisplayName(entry.slug),
        category: entry.category,
        sourceArtSlug: entry.slug,
        formSuffix: entry.formSuffix,
        encounterEligible: isEncounterEligible(kind),
        eggEligible: isEggEligible(kind),
      };
    })
    .sort((left, right) => (
      left.baseSpecies.localeCompare(right.baseSpecies)
      || left.id.localeCompare(right.id)
    ));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(variants, null, 2)}\n`);

  console.log(`Wrote ${path.relative(repoRoot, outputPath)} (${variants.length} variants)`);
}

main();
