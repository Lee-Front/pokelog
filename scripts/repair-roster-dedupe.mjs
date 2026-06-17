#!/usr/bin/env node
// One-time repair for the roster-dedupe data-integrity bug.
//
// A user's roster is split across three UserData fields:
//   - pokemon[] : carried box (party members are a subset of these)
//   - storage[] : PC storage
//   - party[]   : uids referencing into pokemon[], max 6
//
// Invariant that SHOULD hold: every pokemon uid appears at most once across
// pokemon[] ∪ storage[]; party references only uids present in pokemon[]
// (deduped, ≤ 6). Production files drifted into the impossible state (same uid
// in both arrays — sometimes diverged by evolution/leveling — or twice in one
// array) from unsynchronized read-modify-write.
//
// This script reimplements the server's reconcileRoster (user-store.ts) in
// plain JS — keep it byte-for-byte equivalent in BEHAVIOR — and applies it to
// each user JSON file so the repaired files match what the server would now
// read/write at its normalization chokepoint.
//
// Usage:
//   node scripts/repair-roster-dedupe.mjs [usersDir] [--apply]
//
//   usersDir   Path to the users directory. Defaults to
//              $POKELOG_DATA_DIR/users, else ./pokelog-data/users (repo-relative).
//   --apply    Write corrected files back (2-space indent). Without it, DRY RUN
//              only: report findings, write nothing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const MAX_PARTY_SIZE = 6;
const USER_INDEX_FILENAME = "_index.json";

/** Resolve usersDir from argv (first non-flag) → $POKELOG_DATA_DIR/users → default. */
function resolveUsersDir(argv) {
  const positional = argv.find((arg) => !arg.startsWith("--"));
  if (positional) return path.resolve(positional);
  if (process.env.POKELOG_DATA_DIR) {
    return path.join(path.resolve(process.env.POKELOG_DATA_DIR), "users");
  }
  return path.join(repoRoot, "pokelog-data", "users");
}

/**
 * Strictly-more-progressed test, identical to server isMoreProgressed: level
 * first, then exp; equal-or-lower returns false so the first-encountered copy
 * wins ties.
 */
function isMoreProgressed(next, current) {
  const nLvl = Number(next?.level) || 0;
  const cLvl = Number(current?.level) || 0;
  if (nLvl !== cLvl) return nLvl > cLvl;
  const nExp = Number(next?.exp) || 0;
  const cExp = Number(current?.exp) || 0;
  if (nExp !== cExp) return nExp > cExp;
  return false;
}

/**
 * Pure reconcile, semantically identical to server reconcileRoster. Returns the
 * rebuilt { party, pokemon, storage } plus a `report` describing what changed.
 */
function reconcileRoster(roster) {
  const pokemon = Array.isArray(roster.pokemon) ? roster.pokemon : [];
  const storage = Array.isArray(roster.storage) ? roster.storage : [];
  const party = Array.isArray(roster.party) ? roster.party : [];
  const partySet = new Set(party);

  // Group by uid; keep the single most-progressed copy + its origin + first
  // appearance order. Track per-class duplicate stats for reporting.
  const kept = new Map();
  let order = 0;
  let crossArrayDupsRemoved = 0; // a uid present in both pokemon[] and storage[]
  let withinArrayDupsRemoved = 0; // a uid present 2+ times within one array
  const divergedResolved = []; // duplicated uids whose copies differed (species/level/exp)

  const seenOriginsByUid = new Map(); // uid -> Set<origin> seen so far
  const occurrencesByUid = new Map(); // uid -> array of {origin, copy}

  const consider = (entry, origin) => {
    if (!entry || typeof entry.uid !== "string") return; // defensive: skip junk
    const seq = order++;
    const origins = seenOriginsByUid.get(entry.uid) ?? new Set();
    const occ = occurrencesByUid.get(entry.uid) ?? [];
    if (occ.length > 0) {
      // This uid was seen before → a duplicate.
      if (origins.has(origin)) withinArrayDupsRemoved += 1;
      else crossArrayDupsRemoved += 1;
    }
    origins.add(origin);
    occ.push({ origin, copy: entry });
    seenOriginsByUid.set(entry.uid, origins);
    occurrencesByUid.set(entry.uid, occ);

    const existing = kept.get(entry.uid);
    if (!existing) {
      kept.set(entry.uid, { copy: entry, origin, order: seq });
      return;
    }
    if (isMoreProgressed(entry, existing.copy)) {
      existing.copy = entry;
      existing.origin = origin;
    }
  };

  for (const entry of pokemon) consider(entry, "pokemon");
  for (const entry of storage) consider(entry, "storage");

  // Record diverged duplicates (more than one copy, copies not all identical in
  // species/level/exp) along with which copy was kept.
  for (const [uid, occ] of occurrencesByUid) {
    if (occ.length < 2) continue;
    const sig = (p) => `${p.copy?.species}|${p.copy?.level}|${p.copy?.exp}`;
    const distinct = new Set(occ.map(sig));
    if (distinct.size > 1) {
      const keptCopy = kept.get(uid).copy;
      divergedResolved.push({
        uid,
        keptSpecies: keptCopy?.species,
        keptLevel: keptCopy?.level,
        keptExp: keptCopy?.exp,
        variants: occ.map((o) => ({ origin: o.origin, species: o.copy?.species, level: o.copy?.level })),
      });
    }
  }

  // Destination: party members must live in pokemon[]; else honor kept origin.
  // Emit in stable first-appearance order.
  const ordered = [...kept.values()].sort((a, b) => a.order - b.order);
  const nextPokemon = [];
  const nextStorage = [];
  for (const { copy, origin } of ordered) {
    const dest = partySet.has(copy.uid) ? "pokemon" : origin;
    if (dest === "pokemon") nextPokemon.push(copy);
    else nextStorage.push(copy);
  }

  // Party may only reference uids now in pokemon[]; dedupe (first wins), cap.
  const inPokemon = new Set(nextPokemon.map((p) => p.uid));
  const seenParty = new Set();
  const nextParty = [];
  let partyDropped = 0;
  for (const uid of party) {
    if (!inPokemon.has(uid) || seenParty.has(uid)) {
      partyDropped += 1;
      continue;
    }
    if (nextParty.length >= MAX_PARTY_SIZE) {
      partyDropped += 1;
      continue;
    }
    seenParty.add(uid);
    nextParty.push(uid);
  }

  return {
    party: nextParty,
    pokemon: nextPokemon,
    storage: nextStorage,
    report: {
      crossArrayDupsRemoved,
      withinArrayDupsRemoved,
      divergedResolved,
      partyDropped,
    },
  };
}

function isClean(report) {
  return (
    report.crossArrayDupsRemoved === 0 &&
    report.withinArrayDupsRemoved === 0 &&
    report.divergedResolved.length === 0 &&
    report.partyDropped === 0
  );
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const usersDir = resolveUsersDir(argv);

  console.log(`repair-roster-dedupe — ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`usersDir: ${usersDir}`);

  let files;
  try {
    files = fs.readdirSync(usersDir);
  } catch (err) {
    console.error(`Cannot read users dir: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const totals = {
    filesScanned: 0,
    filesParsed: 0,
    filesSkipped: 0,
    filesChanged: 0,
    filesWritten: 0,
    crossArrayDupsRemoved: 0,
    withinArrayDupsRemoved: 0,
    divergedResolved: 0,
    partyDropped: 0,
  };

  const rows = [];

  for (const file of files) {
    if (file === USER_INDEX_FILENAME) continue;
    if (!file.endsWith(".json")) continue;
    totals.filesScanned += 1;

    const filePath = path.join(usersDir, file);
    let data;
    try {
      // Strip a leading UTF-8 BOM if present so JSON.parse doesn't choke.
      const raw = fs.readFileSync(filePath, "utf8").replace(/^﻿/, "");
      data = JSON.parse(raw);
    } catch (err) {
      totals.filesSkipped += 1;
      console.warn(`SKIP (parse error) ${file}: ${err.message}`);
      continue;
    }
    totals.filesParsed += 1;

    let result;
    try {
      result = reconcileRoster({
        party: data.party,
        pokemon: data.pokemon,
        storage: data.storage,
      });
    } catch (err) {
      totals.filesSkipped += 1;
      console.warn(`SKIP (reconcile error) ${file}: ${err.message}`);
      continue;
    }

    const { report } = result;
    totals.crossArrayDupsRemoved += report.crossArrayDupsRemoved;
    totals.withinArrayDupsRemoved += report.withinArrayDupsRemoved;
    totals.divergedResolved += report.divergedResolved.length;
    totals.partyDropped += report.partyDropped;

    if (isClean(report)) continue;
    totals.filesChanged += 1;

    rows.push({
      file,
      cross: report.crossArrayDupsRemoved,
      within: report.withinArrayDupsRemoved,
      diverged: report.divergedResolved.length,
      partyDropped: report.partyDropped,
    });

    for (const d of report.divergedResolved) {
      console.log(
        `  ${file} diverged uid ${d.uid}: kept ${d.keptSpecies} L${d.keptLevel} ` +
          `(exp ${d.keptExp}) over [${d.variants
            .map((v) => `${v.origin}:${v.species} L${v.level}`)
            .join(", ")}]`,
      );
    }

    if (apply) {
      const next = {
        ...data,
        party: result.party,
        pokemon: result.pokemon,
        storage: result.storage,
      };
      try {
        fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
        totals.filesWritten += 1;
        console.log(`  WROTE ${file}`);
      } catch (err) {
        console.warn(`  FAILED to write ${file}: ${err.message}`);
      }
    }
  }

  // Summary table.
  console.log("");
  console.log("Per-file changes:");
  if (rows.length === 0) {
    console.log("  (none — all files already satisfy the invariant)");
  } else {
    const header = "  file".padEnd(34) + "cross  within  diverged  partyDropped";
    console.log(header);
    for (const r of rows) {
      console.log(
        `  ${r.file}`.padEnd(34) +
          `${String(r.cross).padEnd(7)}${String(r.within).padEnd(8)}` +
          `${String(r.diverged).padEnd(10)}${r.partyDropped}`,
      );
    }
  }

  console.log("");
  console.log("Totals:");
  console.log(`  files scanned:            ${totals.filesScanned}`);
  console.log(`  files parsed:             ${totals.filesParsed}`);
  console.log(`  files skipped:            ${totals.filesSkipped}`);
  console.log(`  files needing repair:     ${totals.filesChanged}`);
  console.log(`  cross-array dups removed: ${totals.crossArrayDupsRemoved}`);
  console.log(`  within-array dups removed:${totals.withinArrayDupsRemoved}`);
  console.log(`  diverged uids resolved:   ${totals.divergedResolved}`);
  console.log(`  party entries dropped:    ${totals.partyDropped}`);
  if (apply) {
    console.log(`  files written:            ${totals.filesWritten}`);
  } else {
    console.log("  (DRY RUN — no files written; rerun with --apply to write)");
  }
}

main();
