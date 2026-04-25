/**
 * Scenario 43 — STAB Matrix.
 *
 * Drives `computeStab` directly through the 9-row truth table from the
 * scenario brief and locks in the exact multipliers that the helper
 * (and downstream damage calc) depend on.
 *
 * Key invariants (per battle.ts docstring):
 *  - move type matches Tera type AND original types → 2.0x (2.25 with Adapt)
 *  - move type matches Tera type only → 1.5x (Adapt does not stack)
 *  - move type matches original types only → 1.5x (2.0 with Adapt)
 *  - otherwise → 1.0x
 *
 * Pure function test — no server boot.
 */
import { describe, it, expect } from "vitest";
import { computeStab } from "../../src/game/battle.js";

describe("Scenario 43 — STAB Matrix", () => {
  // ── Classic STAB (no tera) ──
  it("move matches original type, no Tera, no Adaptability → 1.5x", () => {
    expect(computeStab("water", ["water"], false, null, false)).toBe(1.5);
  });

  it("move matches original type, no Tera, Adaptability → 2.0x", () => {
    expect(computeStab("water", ["water"], false, null, true)).toBe(2.0);
  });

  it("move does not match any original type, no Tera → 1.0x", () => {
    expect(computeStab("fire", ["water"], false, null, false)).toBe(1.0);
  });

  it("move does not match original, no Tera, Adaptability irrelevant → 1.0x", () => {
    expect(computeStab("fire", ["water"], false, null, true)).toBe(1.0);
  });

  // ── Combined (Tera matches AND original matches) ──
  it("move matches both Tera and original, no Adaptability → 2.0x (combined)", () => {
    expect(computeStab("water", ["water"], true, "water", false)).toBe(2.0);
  });

  it("move matches both Tera and original, with Adaptability → 2.25x", () => {
    expect(computeStab("water", ["water"], true, "water", true)).toBe(2.25);
  });

  // ── Tera-only (move matches Tera, NOT original) ──
  it("Tera-only match (move matches Tera but not original), no Adaptability → 1.5x", () => {
    expect(computeStab("fire", ["water"], true, "fire", false)).toBe(1.5);
  });

  it("Tera-only match, Adaptability does NOT stack on Tera-acquired type → 1.5x", () => {
    expect(computeStab("fire", ["water"], true, "fire", true)).toBe(1.5);
  });

  // ── Original-only (Tera active but on a different type than the move) ──
  it("move matches original; Tera active but on a different type → 1.5x (original STAB preserved)", () => {
    expect(computeStab("water", ["water"], true, "fire", false)).toBe(1.5);
  });

  it("move matches original; Tera on different type, with Adaptability → 2.0x", () => {
    expect(computeStab("water", ["water"], true, "fire", true)).toBe(2.0);
  });

  // ── Edge cases ──
  it("dual-type pokemon: move matches one of the two original types → 1.5x", () => {
    expect(computeStab("flying", ["fire", "flying"], false, null, false)).toBe(1.5);
  });

  it("dual-type with Adaptability: move matches one original → 2.0x", () => {
    expect(computeStab("flying", ["fire", "flying"], false, null, true)).toBe(2.0);
  });

  it("Tera flag set but teraType null is treated as no Tera", () => {
    // No teraType → matchesTera is false; behavior follows the "no tera" branches.
    expect(computeStab("water", ["water"], true, null, false)).toBe(1.5);
  });

  it("type-shifted Tera (move matches new tera, original is monotype mismatched, no Adapt) → 1.5x", () => {
    // E.g. a pure-water mon teras to fairy and fires moonblast.
    expect(computeStab("fairy", ["water"], true, "fairy", false)).toBe(1.5);
  });

  it("Tera locks in original STAB even when tera type matches no move", () => {
    // Original-water mon, terasted to electric, uses surf (water): combined-STAB
    // does NOT apply because move type ≠ teraType. Falls into "matchesOriginal
    // only" path → 1.5x.
    expect(computeStab("water", ["water"], true, "electric", false)).toBe(1.5);
  });
});
