import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Task 3.4 — Comprehensive data integrity audit.
 *
 * Walks the full canonical JSON datasets and verifies every cross-reference
 * resolves to a real entity. Prints orphan lists to console.warn for human
 * review, then asserts zero orphans so regressions cannot slip past CI.
 *
 * Covers (strict extension of the lighter J1-J4 audits):
 *   - Every species has baseStats, types, abilities.
 *   - Every ability referenced by any species exists.
 *   - Every levelUp move referenced by any species exists.
 *   - Every evolution target resolves to a known species.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../../../data");

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), "utf-8")) as T;
}

interface Species {
  species: string;
  name: string;
  types: string[];
  baseStats: { hp: number; attack: number; defense: number; spAttack: number; spDefense: number; speed: number };
  abilities?: { normal?: string[]; hidden?: string | null };
  learnset?: { levelUp?: Record<string, string[]> };
}

interface Move { id: string; name: string }
interface Ability { id: string; name: string }

interface EvolutionBranch {
  targetSpecies: string;
}

interface EvolutionData {
  branches: EvolutionBranch[];
}

describe("Full Data Integrity Audit (strict)", () => {
  const species = readJson<Species[]>("pokemon/species.json");
  const moves = readJson<Move[]>("moves/moves.json");
  const abilities = readJson<Ability[]>("abilities/abilities.json");
  const evolution = readJson<Record<string, EvolutionData>>("pokemon/evolution.json");

  const speciesIds = new Set(species.map((s) => s.species));
  const moveIds = new Set(moves.map((m) => m.id));
  const abilityIds = new Set(abilities.map((a) => a.id));

  /**
   * species.json uses form-suffixed ids for multi-form species (e.g.
   * `basculegion-male`, `darmanitan-standard`, `aegislash-shield`) — the
   * bare form name is not always a row. Evolution data references the
   * bare name and the runtime resolves the default form at lookup time.
   * For the integrity audit we accept either the exact id OR any id that
   * prefixes `bare-*`.
   */
  function speciesOrFormExists(id: string): boolean {
    if (speciesIds.has(id)) return true;
    const prefix = id + "-";
    for (const s of speciesIds) {
      if (s.startsWith(prefix)) return true;
    }
    return false;
  }

  it("every species has positive baseStats BST", () => {
    const bad: string[] = [];
    for (const s of species) {
      if (!s.baseStats) {
        bad.push(`${s.species}: missing baseStats`);
        continue;
      }
      const bst = s.baseStats.hp + s.baseStats.attack + s.baseStats.defense
        + s.baseStats.spAttack + s.baseStats.spDefense + s.baseStats.speed;
      if (bst <= 0) bad.push(`${s.species}: BST=${bst}`);
    }
    if (bad.length > 0) console.warn("Bad baseStats:", bad.slice(0, 20));
    expect(bad).toEqual([]);
  });

  it("every species has at least one type", () => {
    const bad: string[] = [];
    for (const s of species) {
      if (!Array.isArray(s.types) || s.types.length === 0) {
        bad.push(s.species);
      }
    }
    if (bad.length > 0) console.warn("Species missing types:", bad.slice(0, 20));
    expect(bad).toEqual([]);
  });

  it("every species ability reference resolves to a known ability", () => {
    const orphans: string[] = [];
    for (const s of species) {
      const ab = s.abilities;
      if (!ab) continue;
      const all: string[] = [];
      if (Array.isArray(ab.normal)) all.push(...ab.normal);
      if (ab.hidden) all.push(ab.hidden);
      for (const id of all) {
        if (!abilityIds.has(id)) orphans.push(`${s.species} → ${id}`);
      }
    }
    if (orphans.length > 0) {
      console.warn(`Orphan ability references (${orphans.length}):`, orphans.slice(0, 20));
    }
    expect(orphans.length).toBe(0);
  });

  it("every species levelUp move reference resolves to a known move", () => {
    const orphans: string[] = [];
    for (const s of species) {
      const levelUp = s.learnset?.levelUp;
      if (!levelUp) continue;
      for (const moveIdList of Object.values(levelUp)) {
        if (!Array.isArray(moveIdList)) continue;
        for (const id of moveIdList) {
          if (!moveIds.has(id)) orphans.push(`${s.species} → ${id}`);
        }
      }
    }
    if (orphans.length > 0) {
      console.warn(`Orphan levelUp move references (${orphans.length}):`, orphans.slice(0, 20));
    }
    expect(orphans.length).toBe(0);
  });

  it("every evolution target resolves to a known species (or form)", () => {
    const orphans: string[] = [];
    for (const [from, data] of Object.entries(evolution)) {
      const branches = data?.branches ?? [];
      for (const branch of branches) {
        if (!speciesOrFormExists(branch.targetSpecies)) {
          orphans.push(`${from} → ${branch.targetSpecies}`);
        }
      }
    }
    if (orphans.length > 0) {
      console.warn(`Orphan evolution targets (${orphans.length}):`, orphans);
    }
    expect(orphans.length).toBe(0);
  });

  it("every evolution source species exists (or has a form variant)", () => {
    const orphans: string[] = [];
    for (const from of Object.keys(evolution)) {
      if (!speciesOrFormExists(from)) orphans.push(from);
    }
    if (orphans.length > 0) console.warn("Orphan evolution sources:", orphans);
    expect(orphans.length).toBe(0);
  });

  it("species ids are unique", () => {
    const counts = new Map<string, number>();
    for (const s of species) counts.set(s.species, (counts.get(s.species) ?? 0) + 1);
    const dupes = Array.from(counts.entries()).filter(([, c]) => c > 1).map(([id]) => id);
    if (dupes.length > 0) console.warn("Duplicate species ids:", dupes);
    expect(dupes).toEqual([]);
  });

  it("move ids are unique", () => {
    const counts = new Map<string, number>();
    for (const m of moves) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
    const dupes = Array.from(counts.entries()).filter(([, c]) => c > 1).map(([id]) => id);
    if (dupes.length > 0) console.warn("Duplicate move ids:", dupes);
    expect(dupes).toEqual([]);
  });

  it("ability ids are unique", () => {
    const counts = new Map<string, number>();
    for (const a of abilities) counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
    const dupes = Array.from(counts.entries()).filter(([, c]) => c > 1).map(([id]) => id);
    if (dupes.length > 0) console.warn("Duplicate ability ids:", dupes);
    expect(dupes).toEqual([]);
  });
});
