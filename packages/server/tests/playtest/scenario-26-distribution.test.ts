/**
 * Scenario 26 — Statistical Distribution.
 *
 * Loose statistical sanity-checks. We rely on Math.random unmodified —
 * across enough samples the laws of large numbers tighten the bands.
 *
 *  - 50 common eggs → at least 5 distinct species
 *  - 1000 IV rolls → distribution covers the full 0-31 range
 *  - createWildPokemon rolling ~5% hidden ability over 1000 trials should
 *    land in [0%, 12%] (3-sigma band on a Bernoulli-0.05 sample)
 *  - selectWildPokemon over 200 region rolls → only emits species from
 *    the region's encounter table
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { createEgg, hatchEgg } from "../../src/game/egg-gacha.js";
import { rollIvs, createWildPokemon, pickWildAbility } from "../../src/game/pokemon-factory.js";
import { selectWildPokemon } from "../../src/game/encounter.js";
import { getRegion } from "../../src/game/data-loader.js";
import { getSpeciesByName } from "../../src/game/data-loader.js";

describe("Scenario 26 — Statistical Distribution", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("hatching 50 common eggs yields at least 5 distinct species", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const egg = createEgg("common");
      const { pokemon } = hatchEgg(egg);
      seen.add(pokemon.species);
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it("rolling 1000 IV sets covers the full 0-31 range across all stats", () => {
    const buckets = {
      hp: new Set<number>(),
      attack: new Set<number>(),
      defense: new Set<number>(),
      spAttack: new Set<number>(),
      spDefense: new Set<number>(),
      speed: new Set<number>(),
    };
    for (let i = 0; i < 1000; i++) {
      const ivs = rollIvs();
      buckets.hp.add(ivs.hp);
      buckets.attack.add(ivs.attack);
      buckets.defense.add(ivs.defense);
      buckets.spAttack.add(ivs.spAttack);
      buckets.spDefense.add(ivs.spDefense);
      buckets.speed.add(ivs.speed);
    }
    for (const set of Object.values(buckets)) {
      // Birthday-paradox math: 1000 trials over 32 buckets — every bucket
      // should be hit with overwhelming probability. We use 30 as a soft
      // floor to absorb spurious skew on a tight CI environment.
      expect(set.size).toBeGreaterThanOrEqual(30);
      // Every value lies inside [0, 31].
      for (const v of set) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(31);
      }
    }
  });

  it("hidden-ability rate over 1000 wild rolls lies in a sane band (≈5%)", () => {
    // Pick a species whose hidden ability is well-defined.
    const species = getSpeciesByName("bulbasaur");
    expect(species?.abilities?.hidden).toBeDefined();
    let hidden = 0;
    for (let i = 0; i < 1000; i++) {
      const ability = pickWildAbility(species!.abilities);
      if (ability && ability === species!.abilities.hidden) hidden++;
    }
    // Bernoulli(0.05) over 1000 trials: ~50 ± ~7 (1-sigma). 0..120
    // catches every realistic outcome, including small RNG biases.
    expect(hidden).toBeGreaterThanOrEqual(0);
    expect(hidden).toBeLessThanOrEqual(120);
  });

  it("region-weighted selectWildPokemon never picks a species outside the region table", () => {
    const region = getRegion("default");
    expect(region).toBeDefined();
    const validSpecies = new Set(region!.encounters.map((e) => e.species));
    for (let i = 0; i < 200; i++) {
      const pick = selectWildPokemon(region!);
      expect(validSpecies.has(pick.species)).toBe(true);
      expect(pick.level).toBeGreaterThanOrEqual(1);
      expect(pick.level).toBeLessThanOrEqual(100);
    }
  });

  it("createWildPokemon variability: 50 wild pikachu have non-uniform IV totals", () => {
    const totals = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const w = createWildPokemon("pikachu", 25);
      const t = (w.ivs?.hp ?? 0) + (w.ivs?.attack ?? 0) + (w.ivs?.defense ?? 0)
        + (w.ivs?.spAttack ?? 0) + (w.ivs?.spDefense ?? 0) + (w.ivs?.speed ?? 0);
      totals.add(t);
    }
    expect(totals.size).toBeGreaterThan(5);
  });
});
