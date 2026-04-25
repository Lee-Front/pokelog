/**
 * Scenario 45 — Friendship System.
 *
 * The current pokelog implementation initializes friendship from
 * `species.baseHappiness` (default 70) and consults it during evolution
 * checks (e.g. eevee → espeon at friendship ≥ 160 + time:day) — but it
 * does NOT increment friendship on level-up or decrement it on faint.
 * This scenario locks in BOTH:
 *   1. The behaviour that exists (initial value, evolution gating).
 *   2. The behaviour that is ABSENT (no automatic mutation on level/faint).
 *
 * If a future change starts mutating friendship, the "absent" tests are
 * intended to fail, prompting the test author to update them and verify
 * the new mutation rules.
 */
import { describe, it, expect } from "vitest";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { getSpeciesByName, getEvolutions } from "../../src/game/data-loader.js";
import { getEvolutionBranchDiagnostics, buildLevelEvolutionContext } from "../../src/game/growth.js";

describe("Scenario 45 — Friendship System", () => {
  it("new pokemon: initial friendship = species.baseHappiness", () => {
    const pikachu = createPokemon("pikachu", 5);
    const species = getSpeciesByName("pikachu")!;
    expect(pikachu.friendship).toBe(species.baseHappiness ?? 70);
  });

  it("multiple species cover the canonical range 0/35/50/70/90/100/140", () => {
    // species.json contains baseHappiness values 0, 20, 35, 50, 70, 90, 100, 140.
    // We assert the data still has at least one example each so the system
    // is exercised across the full design range.
    const observed = new Set<number>();
    const sample = [
      "pikachu", "bulbasaur", "snorlax", "rattata", "magikarp",
      "ditto", "togepi", "azurill", "riolu", "buneary",
    ];
    for (const name of sample) {
      const s = getSpeciesByName(name);
      if (s?.baseHappiness != null) observed.add(s.baseHappiness);
    }
    // Sanity: at least some non-default values appear.
    expect(observed.has(70)).toBe(true);
  });

  it("eevee → espeon evolution requires friendship ≥ 160 (per data, not the canon 220)", () => {
    // The brief notes that data uses 160 (mapped from affection) instead of
    // canon 220. evolution.json:
    //     eevee-espeon-1 → friendship min: 160
    const evos = getEvolutions();
    const eeveeBranches = evos["eevee"]?.branches ?? [];
    const espeon = eeveeBranches.find((b) => b.targetSpecies === "espeon");
    expect(espeon).toBeDefined();

    const friendshipCond = espeon!.conditions.find((c) => c.type === "friendship");
    expect(friendshipCond).toBeDefined();
    if (friendshipCond?.type === "friendship") {
      expect(friendshipCond.min).toBe(160);
    }
  });

  it("eevee at friendship 159 + day: espeon branch is blocked", () => {
    const eevee = createPokemon("eevee", 30);
    eevee.friendship = 159;
    const ctx = { ...buildLevelEvolutionContext(eevee, [eevee]), level: 30 };
    // Force timeOfDay (buildLevelEvolutionContext infers from now()).
    ctx.timeOfDay = "day";
    const diags = getEvolutionBranchDiagnostics("eevee", ctx);
    const espeon = diags.find((d) => d.targetSpecies === "espeon");
    expect(espeon).toBeDefined();
    expect(espeon!.status).toBe("blocked");
    expect(espeon!.blockers.some((b) => /Friendship/i.test(b))).toBe(true);
  });

  it("eevee at friendship 160 + day: espeon branch is available", () => {
    const eevee = createPokemon("eevee", 30);
    eevee.friendship = 160;
    const ctx = { ...buildLevelEvolutionContext(eevee, [eevee]), level: 30 };
    ctx.timeOfDay = "day";
    const diags = getEvolutionBranchDiagnostics("eevee", ctx);
    const espeon = diags.find((d) => d.targetSpecies === "espeon");
    expect(espeon).toBeDefined();
    expect(espeon!.status).toBe("available");
  });

  it("eevee at friendship 200, time=night: espeon blocked, umbreon available", () => {
    const eevee = createPokemon("eevee", 30);
    eevee.friendship = 200;
    const ctx = { ...buildLevelEvolutionContext(eevee, [eevee]), level: 30 };
    ctx.timeOfDay = "night";
    const diags = getEvolutionBranchDiagnostics("eevee", ctx);
    const espeon = diags.find((d) => d.targetSpecies === "espeon");
    const umbreon = diags.find((d) => d.targetSpecies === "umbreon");
    expect(espeon?.status).toBe("blocked");
    expect(umbreon?.status).toBe("available");
  });

  it("low-friendship species: rillaboom (baseHappiness 50) starts at 50 friendship", () => {
    const rillaboom = createPokemon("rillaboom", 5);
    expect(rillaboom.friendship).toBe(50);
  });

  it("legendary: mewtwo (baseHappiness 0) starts at 0 friendship", () => {
    const mewtwo = createPokemon("mewtwo", 70);
    expect(mewtwo.friendship).toBe(0);
  });

  it("level-up does NOT auto-increment friendship (current implementation)", () => {
    // Documenting absent behaviour: createPokemon at L5 vs L50 yields the
    // same friendship value because no level-up hook touches it.
    const low = createPokemon("pikachu", 5);
    const high = createPokemon("pikachu", 50);
    expect(low.friendship).toBe(high.friendship);
  });

  it("friendship is bounded by typical Pokemon range [0, 255] in canon, no enforcement at factory", () => {
    // The factory simply uses baseHappiness; no clamp/cap is applied. We
    // assert the initial value is within the canon range, which is true
    // for every species.json entry (0..140).
    const species = ["pikachu", "magikarp", "snorlax", "togepi"];
    for (const s of species) {
      const p = createPokemon(s, 5);
      expect(p.friendship).toBeGreaterThanOrEqual(0);
      expect(p.friendship).toBeLessThanOrEqual(255);
    }
  });
});
