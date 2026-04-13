import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const regularArtDir = path.join(repoRoot, "data", "colorscripts", "small", "regular");
const speciesPath = path.join(repoRoot, "data", "pokemon", "species.json");
const splitPath = path.join(repoRoot, "data", "pokemon", "art-species-split.json");
const docPath = path.join(repoRoot, "docs", "pokemon-art-split.md");

const CANONICAL_HYPHENATED_BASES = new Set([
  "chien-pao",
  "chi-yu",
  "brute-bonnet",
  "flutter-mane",
  "gouging-fire",
  "great-tusk",
  "hakamo-o",
  "ho-oh",
  "iron-boulder",
  "iron-bundle",
  "iron-crown",
  "iron-hands",
  "iron-jugulis",
  "iron-leaves",
  "iron-moth",
  "iron-thorns",
  "iron-treads",
  "jangmo-o",
  "kommo-o",
  "mime-jr",
  "mr-mime",
  "mr-rime",
  "nidoran-f",
  "nidoran-m",
  "porygon-z",
  "raging-bolt",
  "roaring-moon",
  "sandy-shocks",
  "scream-tail",
  "slither-wing",
  "tapu-bulu",
  "tapu-fini",
  "tapu-koko",
  "tapu-lele",
  "ting-lu",
  "type-null",
  "walking-wake",
  "wo-chien",
]);

const CATEGORY_RULES = [
  { category: "mega", pattern: /-mega(?:-[xy])?$/ },
  { category: "gigantamax", pattern: /-gmax$/ },
  { category: "regional", pattern: /-(?:alola|galar|hisui)$/ },
  { category: "regional-special", pattern: /-(?:galar-zen|hisui-noble|noble)$/ },
  { category: "primal", pattern: /-primal$/ },
  { category: "origin", pattern: /-origin$/ },
  { category: "therian", pattern: /-therian$/ },
  { category: "rider", pattern: /-(?:ice-rider|shadow-rider)$/ },
  {
    category: "battle-form",
    pattern: /-(?:10|active|ash|attack|blade|busted|complete|defense|disguised|eternamax|gorging|gulping|hangry|hero|noice|school|shield|speed|zen)$/,
  },
  {
    category: "pattern-form",
    pattern: /-(?:archipelago|blank|blue-striped|continental|dawn|dusk|east|elegant|fancy|filled|garden|high-plains|icy-snow|jungle|marine|midday|midnight|modern|monsoon|ocean|ordinary|poke-ball|polar|rainy|river|sandstorm|savanna|snowy|solo|sun|sunny|sunshine|tundra|west|white-striped)$/,
  },
  { category: "seasonal-form", pattern: /-(?:autumn|spring|summer|winter)$/ },
  { category: "size-form", pattern: /-(?:large|small|super)$/ },
  {
    category: "type-form",
    pattern: /-(?:bug|dark|dragon|electric|fairy|fighting|fire|flying|ghost|grass|ground|ice|poison|psychic|rock|steel|unknown|water)$/,
  },
  { category: "gene-drive", pattern: /-(?:burn|chill|douse|shock)$/ },
  {
    category: "cap-form",
    pattern: /-(?:alola-cap|hoenn-cap|kalos-cap|original-cap|partner-cap|sinnoh-cap|unova-cap|world-cap)$/,
  },
  {
    category: "costume-form",
    pattern: /-(?:belle|cosplay|flying|libre|phd|pop-star|rock-star|starter|surfing)$/,
  },
  { category: "alcremie-form", pattern: /^alcremie-/ },
  { category: "trim-form", pattern: /-(?:dandy|debutante|diamond|heart|kabuki|la-reine|matron|pharaoh|star)$/ },
  { category: "color-form", pattern: /-(?:black|blue|green|indigo|orange|red|violet|white|yellow)$/ },
  { category: "rotom-appliance", pattern: /-(?:fan|frost|heat|mow|wash)$/ },
  { category: "cloak-form", pattern: /-(?:plant|sandy|trash)$/ },
  { category: "unown-form", pattern: /^unown-(?:[a-z]|exclamation|question)$/ },
  {
    category: "event-form",
    pattern: /-(?:amped|aria|baile|crowned|dada|dawn-wings|dusk-mane|eternal|family-of-three|family-of-four|gen7|land|low-key|original|pau|pirouette|pom-pom|rapid-strike|resolute|sensu|shadow|single-strike|sky|spiky-eared|ultra|unbound)$/,
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function formatPercent(part, total) {
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

function isBaseSlug(slug) {
  return !slug.includes("-") || CANONICAL_HYPHENATED_BASES.has(slug);
}

function getDirectParentSlug(slug, slugSet) {
  const parts = slug.split("-");
  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const candidate = parts.slice(0, index).join("-");
    if (slugSet.has(candidate)) {
      return candidate;
    }
  }
  return parts[0];
}

function classifySpecialSlug(slug) {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(slug)) {
      return rule.category;
    }
  }
  return "unclassified-special";
}

function buildRootResolver(baseSet, parentMap) {
  return function resolveRootBaseSlug(slug) {
    let current = slug;
    const seen = new Set();

    while (!baseSet.has(current) && parentMap.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parentMap.get(current);
    }

    return current;
  };
}

const allArtSlugs = uniqueSorted(
  fs.readdirSync(regularArtDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name),
);
const speciesData = readJson(speciesPath);
const speciesSet = new Set(speciesData.map((entry) => entry.species));
const artSlugSet = new Set(allArtSlugs);

const baseSpeciesSlugs = allArtSlugs.filter((slug) => isBaseSlug(slug));
const specialFormSlugs = allArtSlugs.filter((slug) => !isBaseSlug(slug));
const baseSpeciesSet = new Set(baseSpeciesSlugs);

const parentMap = new Map(
  specialFormSlugs.map((slug) => [slug, getDirectParentSlug(slug, artSlugSet)]),
);
const resolveRootBaseSlug = buildRootResolver(baseSpeciesSet, parentMap);

const specialForms = specialFormSlugs.map((slug) => {
  const directParentSlug = parentMap.get(slug);
  const rootBaseSlug = resolveRootBaseSlug(slug);
  const formSuffix = directParentSlug && slug.startsWith(`${directParentSlug}-`)
    ? slug.slice(directParentSlug.length + 1)
    : slug.split("-").slice(1).join("-");

  return {
    slug,
    category: classifySpecialSlug(slug),
    directParentSlug,
    rootBaseSlug,
    formSuffix,
  };
});

const categoryCounts = Object.fromEntries(
  [...specialForms.reduce((map, form) => {
    map.set(form.category, (map.get(form.category) ?? 0) + 1);
    return map;
  }, new Map()).entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
);

const baseSpeciesCovered = baseSpeciesSlugs.filter((slug) => speciesSet.has(slug));
const baseSpeciesMissingData = baseSpeciesSlugs.filter((slug) => !speciesSet.has(slug));
const specialFormsCovered = specialForms.filter((form) => speciesSet.has(form.slug));
const unclassifiedSpecials = specialForms.filter((form) => form.category === "unclassified-special");

const splitPayload = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalArtSlugs: allArtSlugs.length,
    baseSpeciesCount: baseSpeciesSlugs.length,
    specialFormCount: specialForms.length,
    baseSpeciesCoveredByCurrentData: baseSpeciesCovered.length,
    baseSpeciesCoveragePercent: Number(formatPercent(baseSpeciesCovered.length, baseSpeciesSlugs.length)),
    specialFormsCoveredByCurrentData: specialFormsCovered.length,
    specialFormCategoryCounts: categoryCounts,
    unclassifiedSpecialCount: unclassifiedSpecials.length,
  },
  baseSpeciesSlugs,
  baseSpeciesMissingData,
  specialForms,
  unclassifiedSpecials: unclassifiedSpecials.map((form) => form.slug),
};

const splitDoc = `# Pokemon Art Split

Generated: ${splitPayload.generatedAt}

## Summary

- Raw regular art slugs: ${allArtSlugs.length}
- Base species candidates: ${baseSpeciesSlugs.length}
- Special forms: ${specialForms.length}
- Current \`species.json\` coverage for base species: ${baseSpeciesCovered.length}/${baseSpeciesSlugs.length} (${formatPercent(baseSpeciesCovered.length, baseSpeciesSlugs.length)}%)
- Current \`species.json\` entries that are already special forms: ${specialFormsCovered.length}
- Unclassified special slugs: ${unclassifiedSpecials.length}

## Why This Split Exists

- Raw art slugs include many forms that should not be treated as separate encounter species by default.
- This split keeps canonical species such as \`mr-mime\`, \`ho-oh\`, \`jangmo-o\`, and \`wo-chien\` in the base list.
- Forms such as megas, regional variants, gigantamax, battle forms, and cosmetic variants are moved into a separate list.

## Special Form Categories

${Object.entries(categoryCounts).map(([category, count]) => `- ${category}: ${count}`).join("\n")}

## Base Species Missing Data Preview

${previewList(baseSpeciesMissingData, 40)}

## Special Form Preview

${specialForms.slice(0, 30).map((form) => `- \`${form.slug}\` -> \`${form.rootBaseSlug}\` (${form.category})`).join("\n")}

## Recommended Usage

1. Use \`baseSpeciesSlugs\` as the default source for encounter pools, egg pools, and first-pass species data entry.
2. Keep \`specialForms\` out of normal region and egg rolls until form systems exist.
3. Add special forms later through explicit mechanics such as regional pools, battle transformations, or cosmetic unlocks.
`;

fs.mkdirSync(path.dirname(splitPath), { recursive: true });
fs.mkdirSync(path.dirname(docPath), { recursive: true });
fs.writeFileSync(splitPath, `${JSON.stringify(splitPayload, null, 2)}\n`);
fs.writeFileSync(docPath, `${splitDoc}\n`);

console.log(`Wrote ${path.relative(repoRoot, splitPath)}`);
console.log(`Wrote ${path.relative(repoRoot, docPath)}`);
console.log(`Base species: ${baseSpeciesSlugs.length}`);
console.log(`Special forms: ${specialForms.length}`);
console.log(`Unclassified special slugs: ${unclassifiedSpecials.length}`);
