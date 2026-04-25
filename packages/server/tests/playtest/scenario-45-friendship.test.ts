/**
 * Scenario 45 — Friendship System.
 *
 * Friendship is initialized from `species.baseHappiness` (default 70) and
 * accumulates / decays through gameplay actions:
 *   - level-up:   +5 per level
 *   - vitamin:    +5 per use
 *   - heal-item:  +1 per use
 *   - pve-win:    +1 to the active pokemon
 *   - pvp-win:    +2 to every alive party member
 *   - tower-win:  +3 to every alive party member
 *   - faint:      -5 (PvE only — PvP/tower fights occur on copies)
 *   - trade:      reset to baseHappiness on receipt
 *
 * This scenario locks down both the static behaviour (initial value,
 * evolution gating) and the new dynamic accumulation, including a
 * full integration check that an Eevee can naturally reach the 160
 * threshold and evolve into Espeon (day) / Umbreon (night).
 */
import { describe, it, expect } from "vitest";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import { getSpeciesByName, getEvolutions } from "../../src/game/data-loader.js";
import {
  getEvolutionBranchDiagnostics,
  buildLevelEvolutionContext,
  resolveEvolution,
} from "../../src/game/growth.js";
import { adjustFriendship } from "../../src/game/friendship.js";

describe("Scenario 45 — Friendship System", () => {
  it("new pokemon: initial friendship = species.baseHappiness", () => {
    const pikachu = createPokemon("pikachu", 5);
    const species = getSpeciesByName("pikachu")!;
    expect(pikachu.friendship).toBe(species.baseHappiness ?? 70);
  });

  it("multiple species cover the canonical baseHappiness range", () => {
    const observed = new Set<number>();
    const sample = [
      "pikachu", "bulbasaur", "snorlax", "rattata", "magikarp",
      "ditto", "togepi", "azurill", "riolu", "buneary",
    ];
    for (const name of sample) {
      const s = getSpeciesByName(name);
      if (s?.baseHappiness != null) observed.add(s.baseHappiness);
    }
    expect(observed.has(70)).toBe(true);
  });

  it("eevee → espeon evolution requires friendship ≥ 160 (per data, not the canon 220)", () => {
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

  it("level-up grants +5 friendship per level", () => {
    const pikachu = createPokemon("pikachu", 5);
    pikachu.friendship = 70;
    adjustFriendship(pikachu, "level-up");
    expect(pikachu.friendship).toBe(75);
  });

  it("pve-win grants +1 friendship to the active pokemon", () => {
    const pikachu = createPokemon("pikachu", 5);
    pikachu.friendship = 70;
    adjustFriendship(pikachu, "pve-win");
    expect(pikachu.friendship).toBe(71);
  });

  it("integration: 90 PvE wins push eevee from 70 → 160 (canon evolution threshold)", () => {
    const eevee = createPokemon("eevee", 30);
    // Eevee's canon baseHappiness is 50 in the dataset; force a known
    // starting value so the arithmetic is deterministic.
    eevee.friendship = 70;

    for (let i = 0; i < 90; i++) {
      adjustFriendship(eevee, "pve-win");
    }
    expect(eevee.friendship).toBe(160);

    // Confirm espeon (day) is unlocked at this exact threshold.
    const ctx = { ...buildLevelEvolutionContext(eevee, [eevee]), level: 30 };
    ctx.timeOfDay = "day";
    const branch = resolveEvolution("eevee", ctx);
    expect(branch?.targetSpecies).toBe("espeon");
  });

  it("integration: night-time eevee with same friendship resolves to umbreon", () => {
    const eevee = createPokemon("eevee", 30);
    eevee.friendship = 70;
    for (let i = 0; i < 90; i++) {
      adjustFriendship(eevee, "pve-win");
    }
    const ctx = { ...buildLevelEvolutionContext(eevee, [eevee]), level: 30 };
    ctx.timeOfDay = "night";
    const branch = resolveEvolution("eevee", ctx);
    expect(branch?.targetSpecies).toBe("umbreon");
  });

  it("friendship is bounded by canon range [0, 255]", () => {
    const species = ["pikachu", "magikarp", "snorlax", "togepi"];
    for (const s of species) {
      const p = createPokemon(s, 5);
      expect(p.friendship).toBeGreaterThanOrEqual(0);
      expect(p.friendship).toBeLessThanOrEqual(255);
    }

    // Saturate via repeated vitamins — must not exceed 255.
    const target = createPokemon("pikachu", 5);
    target.friendship = 0;
    for (let i = 0; i < 200; i++) adjustFriendship(target, "vitamin");
    expect(target.friendship).toBe(255);
  });
});
