/**
 * generate-encounter-pools.mjs
 *
 * Reads species.json, evolution.json, and variants.json to produce balanced
 * encounter-pool files for every region under data/regions/.
 *
 * Idempotent — running it again produces identical output.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// 1. Load data
// ---------------------------------------------------------------------------

const species = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/pokemon/species.json"), "utf-8"),
);
const evolution = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/pokemon/evolution.json"), "utf-8"),
);
const variants = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/pokemon/variants.json"), "utf-8"),
);

// ---------------------------------------------------------------------------
// 2. Constants
// ---------------------------------------------------------------------------

const ULTRA_BEASTS = new Set([
  "nihilego", "buzzwole", "pheromosa", "xurkitree", "celesteela",
  "kartana", "guzzlord", "poipole", "naganadel", "stakataka", "blacephalon",
]);

const STARTER_BASE = new Set([
  "bulbasaur", "charmander", "squirtle",
  "chikorita", "cyndaquil", "totodile",
  "treecko", "torchic", "mudkip",
  "turtwig", "chimchar", "piplup",
  "snivy", "tepig", "oshawott",
  "chespin", "fennekin", "froakie",
  "rowlet", "litten", "popplio",
  "grookey", "scorbunny", "sobble",
]);

const FOSSIL_BASE = new Set([
  "omanyte", "kabuto", "aerodactyl",
  "lileep", "anorith",
  "cranidos", "shieldon",
  "tirtouga", "archen",
  "tyrunt", "amaura",
  "dracozolt", "arctozolt", "dracovish", "arctovish",
]);

const GEN_RANGES = [
  { gen: 1, min: 1, max: 151 },
  { gen: 2, min: 152, max: 251 },
  { gen: 3, min: 252, max: 386 },
  { gen: 4, min: 387, max: 493 },
  { gen: 5, min: 494, max: 649 },
  { gen: 6, min: 650, max: 721 },
  { gen: 7, min: 722, max: 809 },
  { gen: 8, min: 810, max: 905 },
];

const REGION_GEN = {
  kanto: 1,
  johto: 2,
  hoenn: 3,
  sinnoh: 4,
  unova: 5,
  kalos: 6,
  alola: 7,
  galar: 8,
  hisui: 8,
};

const REGION_DISPLAY = {
  kanto: "Kanto",
  johto: "Johto",
  hoenn: "Hoenn",
  sinnoh: "Sinnoh",
  unova: "Unova",
  kalos: "Kalos",
  alola: "Alola",
  galar: "Galar",
  hisui: "Hisui",
  default: "default",
};

// ---------------------------------------------------------------------------
// 3. Build lookup structures
// ---------------------------------------------------------------------------

/** Map species name -> species record */
const speciesByName = new Map();
for (const s of species) {
  speciesByName.set(s.species, s);
}

/** Determine generation from ID */
function getGen(id) {
  for (const r of GEN_RANGES) {
    if (id >= r.min && id <= r.max) return r.gen;
  }
  return 8; // fallback
}

// ---------------------------------------------------------------------------
// 4. Classify evolution stage
// ---------------------------------------------------------------------------

// Build targetOf set (species that are the target of some evolution branch)
const targetOf = new Set();
// Build hasBranches set (species that have at least one evolution branch)
const hasBranches = new Set();
for (const [src, data] of Object.entries(evolution)) {
  if (data.branches.length > 0) {
    hasBranches.add(src);
    for (const b of data.branches) {
      targetOf.add(b.targetSpecies);
    }
  }
}

function getStage(speciesName) {
  // Resolve base name for form-suffixed species (e.g. deoxys-normal -> deoxys)
  let baseName = speciesName;
  const dash = speciesName.indexOf("-");
  if (dash > 0) {
    const prefix = speciesName.substring(0, dash);
    // Use prefix if the full name is not directly in evolution data
    if (!evolution[speciesName] && evolution[prefix]) {
      baseName = prefix;
    }
  }

  const isTarget = targetOf.has(baseName) || targetOf.has(speciesName);
  const hasEvos = hasBranches.has(baseName) || hasBranches.has(speciesName);

  if (!isTarget && hasEvos) return "base";
  if (isTarget && hasEvos) return "middle";
  if (isTarget && !hasEvos) return "final";
  return "single"; // not a target and has no branches
}

// ---------------------------------------------------------------------------
// 5. Build starter / fossil full-line sets (including evolutions)
// ---------------------------------------------------------------------------

function buildLineSet(baseSet) {
  const full = new Set(baseSet);
  const queue = [...baseSet];
  while (queue.length > 0) {
    const current = queue.shift();
    const evo = evolution[current];
    if (evo) {
      for (const b of evo.branches) {
        if (!full.has(b.targetSpecies)) {
          full.add(b.targetSpecies);
          queue.push(b.targetSpecies);
        }
      }
    }
  }
  return full;
}

const STARTER_LINE = buildLineSet(STARTER_BASE);
const FOSSIL_LINE = buildLineSet(FOSSIL_BASE);

// ---------------------------------------------------------------------------
// 6. Identify trade-evolution-only species
// ---------------------------------------------------------------------------

const targetTriggers = {};
for (const [src, data] of Object.entries(evolution)) {
  for (const b of data.branches) {
    if (!targetTriggers[b.targetSpecies]) targetTriggers[b.targetSpecies] = [];
    targetTriggers[b.targetSpecies].push(b.trigger);
  }
}

const TRADE_EVO_ONLY = new Set();
for (const [target, triggers] of Object.entries(targetTriggers)) {
  if (triggers.every((t) => t === "trade")) {
    TRADE_EVO_ONLY.add(target);
  }
}

// ---------------------------------------------------------------------------
// 7. Classify special category
// ---------------------------------------------------------------------------

function getCategory(s) {
  const name = s.species;
  // Resolve base name for form-suffixed species
  let baseName = name;
  const dash = name.indexOf("-");
  if (dash > 0) {
    baseName = name.substring(0, dash);
  }

  if (s.isMythical) return "mythical";
  if (ULTRA_BEASTS.has(baseName) || ULTRA_BEASTS.has(name)) return "ultra-beast";
  if (s.isLegendary) return "legendary";
  if (s.isBaby) return "baby";
  if (FOSSIL_LINE.has(baseName) || FOSSIL_LINE.has(name)) return "fossil";
  if (STARTER_LINE.has(baseName) || STARTER_LINE.has(name)) return "starter";
  if (TRADE_EVO_ONLY.has(baseName) || TRADE_EVO_ONLY.has(name)) return "trade-evo";
  return "normal";
}

// ---------------------------------------------------------------------------
// 8. Weight and level range assignment
// ---------------------------------------------------------------------------

function getWeight(s, stage, category) {
  const rawCaptureRate = s.rawCaptureRate ?? 45;

  // Ultra rare
  if (category === "mythical" || category === "ultra-beast") return 1;
  if (category === "legendary") return 2;
  if (category === "fossil") return 3;

  // Starters
  if (category === "starter") {
    if (stage === "base") return 10;
    if (stage === "middle") return 5;
    return 3; // final
  }

  // Trade evolution targets
  if (category === "trade-evo") return 8;

  // Baby
  if (category === "baby") return 15;

  // Normal by stage
  if (stage === "base") {
    if (rawCaptureRate >= 200) return 80;
    if (rawCaptureRate >= 150) return 60;
    if (rawCaptureRate >= 100) return 45;
    return 30;
  }
  if (stage === "middle") return 15;
  if (stage === "final") return 8;
  if (stage === "single") {
    if (rawCaptureRate >= 150) return 50;
    if (rawCaptureRate >= 100) return 30;
    return 15;
  }

  return 30;
}

function getLevelRange(stage, category) {
  if (
    category === "legendary" ||
    category === "mythical" ||
    category === "ultra-beast"
  )
    return [40, 60];
  if (category === "baby") return [1, 5];
  if (category === "fossil") return [15, 25];
  if (stage === "base") return [2, 10];
  if (stage === "middle") return [15, 30];
  if (stage === "final") return [30, 50];
  if (stage === "single") return [10, 25];
  return [5, 15];
}

// ---------------------------------------------------------------------------
// 9. Classify all 905 species
// ---------------------------------------------------------------------------

const classified = [];
for (const s of species) {
  const stage = getStage(s.species);
  const category = getCategory(s);
  const gen = getGen(s.id);
  const weight = getWeight(s, stage, category);
  const levelRange = getLevelRange(stage, category);

  classified.push({
    species: s.species,
    id: s.id,
    stage,
    category,
    gen,
    weight,
    levelRange,
  });
}

// ---------------------------------------------------------------------------
// 10. Build encounter entry from classified record
// ---------------------------------------------------------------------------

function toEncounter(c) {
  return {
    species: c.species,
    weight: c.weight,
    levelRange: c.levelRange,
  };
}

// ---------------------------------------------------------------------------
// 11. Gather regional variants
// ---------------------------------------------------------------------------

const regionalVariants = {
  alola: [],
  galar: [],
  hisui: [],
};

for (const v of variants) {
  if (!v.encounterEligible) continue;
  if (v.kind !== "regional" && v.category !== "regional") {
    // Only include actual regional forms, not megas/battle-forms
    // Check if formSuffix matches a region
    if (!["alola", "galar", "hisui"].includes(v.formSuffix)) continue;
  }
  const suffix = v.formSuffix;
  if (suffix && regionalVariants[suffix]) {
    // Look up the base species to get capture rate for weight calculation
    const baseSpecies = speciesByName.get(v.baseSpecies);
    if (!baseSpecies) continue;

    const stage = getStage(v.baseSpecies);
    const category = getCategory(baseSpecies);
    const weight = getWeight(baseSpecies, stage, category);
    const levelRange = getLevelRange(stage, category);

    regionalVariants[suffix].push({
      species: v.id, // e.g. "vulpix-alola"
      weight,
      levelRange,
    });
  }
}

// ---------------------------------------------------------------------------
// 12. Build region pools
// ---------------------------------------------------------------------------

function buildRegionPool(regionName) {
  const gen = REGION_GEN[regionName];
  const encounters = [];
  const seen = new Set();

  // Add all species from the matching generation
  for (const c of classified) {
    if (c.gen === gen) {
      encounters.push(toEncounter(c));
      seen.add(c.species);
    }
  }

  // Add regional variants for this region
  const regionVariants = regionalVariants[regionName] || [];
  for (const rv of regionVariants) {
    if (!seen.has(rv.species)) {
      encounters.push(rv);
      seen.add(rv.species);
    }
  }

  // For hisui: also include species that have hisui variants (the base species
  // if not already included from gen 8)
  if (regionName === "hisui") {
    for (const v of variants) {
      if (v.formSuffix !== "hisui" || !v.encounterEligible) continue;
      const baseSpecies = v.baseSpecies;
      if (!seen.has(baseSpecies)) {
        const c = classified.find((x) => x.species === baseSpecies);
        if (c) {
          encounters.push(toEncounter(c));
          seen.add(c.species);
        }
      }
    }
  }

  // Sort by weight descending (common first), then alphabetically for stability
  encounters.sort((a, b) => b.weight - a.weight || a.species.localeCompare(b.species));

  return {
    name: REGION_DISPLAY[regionName],
    encounters,
  };
}

function buildDefaultPool() {
  const encounters = [];
  const seen = new Set();

  // Pick ~15 from each gen for variety (deterministic: pick by highest weight
  // among normal species, then by id for stability)
  const PER_GEN = 15;
  for (const genRange of GEN_RANGES) {
    const genSpecies = classified
      .filter((c) => c.gen === genRange.gen)
      .filter(
        (c) =>
          c.category !== "legendary" &&
          c.category !== "mythical" &&
          c.category !== "ultra-beast",
      );
    // Sort by weight desc, then by id asc for determinism
    genSpecies.sort((a, b) => b.weight - a.weight || a.id - b.id);
    const picked = genSpecies.slice(0, PER_GEN);
    for (const c of picked) {
      if (!seen.has(c.species)) {
        encounters.push(toEncounter(c));
        seen.add(c.species);
      }
    }
  }

  // Add ALL legendaries, mythicals, and ultra beasts
  for (const c of classified) {
    if (
      (c.category === "legendary" ||
        c.category === "mythical" ||
        c.category === "ultra-beast") &&
      !seen.has(c.species)
    ) {
      encounters.push(toEncounter(c));
      seen.add(c.species);
    }
  }

  // Sort by weight descending, then alphabetically for stability
  encounters.sort((a, b) => b.weight - a.weight || a.species.localeCompare(b.species));

  return {
    name: "default",
    encounters,
  };
}

// ---------------------------------------------------------------------------
// 13. Write output files
// ---------------------------------------------------------------------------

const regionsDir = path.join(ROOT, "data/regions");

const regionNames = [
  "kanto", "johto", "hoenn", "sinnoh",
  "unova", "kalos", "alola", "galar", "hisui",
];

const allPools = {};

for (const name of regionNames) {
  const pool = buildRegionPool(name);
  allPools[name] = pool;
  const filePath = path.join(regionsDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(pool, null, 2) + "\n", "utf-8");
}

const defaultPool = buildDefaultPool();
allPools["default"] = defaultPool;
fs.writeFileSync(
  path.join(regionsDir, "default.json"),
  JSON.stringify(defaultPool, null, 2) + "\n",
  "utf-8",
);

// ---------------------------------------------------------------------------
// 14. Print summary
// ---------------------------------------------------------------------------

const allSpecies = new Set();
for (const [, pool] of Object.entries(allPools)) {
  for (const e of pool.encounters) {
    allSpecies.add(e.species);
  }
}

console.log("=== Encounter Pool Generation Summary ===\n");

for (const name of [...regionNames, "default"]) {
  const pool = allPools[name];
  console.log(`  ${pool.name.padEnd(10)} ${String(pool.encounters.length).padStart(4)} species`);
}

console.log("");
console.log(`  Total unique species/variants: ${allSpecies.size}`);
console.log(`  Base species in dataset:       905`);

// Count unique base species only (excluding variant slugs like vulpix-alola)
const baseSpeciesSet = new Set();
for (const s of allSpecies) {
  // If species matches a variant id, use the base species
  const variant = variants.find((v) => v.id === s);
  if (variant) {
    baseSpeciesSet.add(variant.baseSpecies);
  } else {
    baseSpeciesSet.add(s);
  }
}
const coverage = ((baseSpeciesSet.size / 905) * 100).toFixed(1);
console.log(`  Unique base species covered:   ${baseSpeciesSet.size}`);
console.log(`  Coverage:                      ${coverage}%`);
console.log("\nDone. Region files written to data/regions/");
