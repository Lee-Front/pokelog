/**
 * generate-gmax-moves.mjs
 *
 * Generates G-Max exclusive move entries and appends them to moves.json.
 * Each Gigantamax species has one exclusive G-Max move tied to a specific type.
 *
 * Idempotent — existing G-Max moves are removed before appending fresh entries.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// G-Max move definitions
// ---------------------------------------------------------------------------

const GMAX_MOVES = [
  { id: "g-max-vine-lash",   type: "grass",    species: "venusaur" },
  { id: "g-max-wildfire",    type: "fire",     species: "charizard" },
  { id: "g-max-cannonade",   type: "water",    species: "blastoise" },
  { id: "g-max-befuddle",    type: "bug",      species: "butterfree" },
  { id: "g-max-volt-crash",  type: "electric", species: "pikachu" },
  { id: "g-max-gold-rush",   type: "normal",   species: "meowth" },
  { id: "g-max-chi-strike",  type: "fighting", species: "machamp" },
  { id: "g-max-terror",      type: "ghost",    species: "gengar" },
  { id: "g-max-foam-burst",  type: "water",    species: "kingler" },
  { id: "g-max-resonance",   type: "ice",      species: "lapras" },
  { id: "g-max-cuddle",      type: "normal",   species: "eevee" },
  { id: "g-max-replenish",   type: "normal",   species: "snorlax" },
  { id: "g-max-malodor",     type: "poison",   species: "garbodor" },
  { id: "g-max-stonesurge",  type: "water",    species: "drednaw" },
  { id: "g-max-wind-rage",   type: "flying",   species: "corviknight" },
  { id: "g-max-gravitas",    type: "psychic",  species: "orbeetle" },
  { id: "g-max-volcalith",   type: "rock",     species: "coalossal" },
  { id: "g-max-tartness",    type: "grass",    species: "flapple" },
  { id: "g-max-sweetness",   type: "grass",    species: "appletun" },
  { id: "g-max-sandblast",   type: "ground",   species: "sandaconda" },
  { id: "g-max-stun-shock",  type: "poison",   species: "toxtricity" },
  { id: "g-max-centiferno",  type: "fire",     species: "centiskorch" },
  { id: "g-max-smite",       type: "fairy",    species: "hatterene" },
  { id: "g-max-snooze",      type: "dark",     species: "grimmsnarl" },
  { id: "g-max-finale",      type: "fairy",    species: "alcremie" },
  { id: "g-max-steelsurge",  type: "steel",    species: "copperajah" },
  { id: "g-max-depletion",   type: "dragon",   species: "duraludon" },
  { id: "g-max-drum-solo",   type: "grass",    species: "rillaboom" },
  { id: "g-max-fireball",    type: "fire",     species: "cinderace" },
  { id: "g-max-hydrosnipe",  type: "water",    species: "inteleon" },
  { id: "g-max-one-blow",    type: "dark",     species: "urshifu-single-strike" },
  { id: "g-max-rapid-flow",  type: "water",    species: "urshifu-rapid-strike" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert kebab-case id to Title Case name */
function formatName(id) {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildMoveEntry(def) {
  return {
    id: def.id,
    name: formatName(def.id),
    type: def.type,
    category: "physical",
    power: 100,
    accuracy: 100,
    pp: 5,
    description: "G-Max exclusive move",
    priority: 0,
    target: "selected-pokemon",
    meta: {
      ailment: "none",
      ailmentChance: 0,
      critRate: 0,
      drain: 0,
      flinchChance: 0,
      healing: 0,
      statChance: 0,
    },
    statChanges: [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const movesPath = path.join(ROOT, "data/moves/moves.json");
const moves = JSON.parse(fs.readFileSync(movesPath, "utf-8"));

// Remove any existing g-max moves (idempotent)
const filtered = moves.filter((m) => !m.id.startsWith("g-max-"));

// Generate new entries
const gmaxEntries = GMAX_MOVES.map(buildMoveEntry);

// Append and sort alphabetically by id
const merged = [...filtered, ...gmaxEntries].sort((a, b) =>
  a.id.localeCompare(b.id),
);

fs.writeFileSync(movesPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");

console.log(`Added ${gmaxEntries.length} G-Max moves to moves.json (total: ${merged.length} moves)`);
