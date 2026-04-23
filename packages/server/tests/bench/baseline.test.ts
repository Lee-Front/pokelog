import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Task 3.7 — Performance baseline.
 *
 * Rather than use vitest's `bench` mode (requires a separate config), we
 * use regular tests that time hot paths with `performance.now()` and
 * print the numbers. The baseline values recorded on 2026-04-23 are
 * captured in docs/performance-baseline.md. The tests assert loose upper
 * bounds so future regressions (e.g. 10x slowdowns) trip CI.
 */

interface Stats { mean: number; min: number; max: number; count: number }

function bench(name: string, iters: number, fn: () => void): Stats {
  // Warm up — ignore first few iterations for JIT.
  for (let i = 0; i < 3; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  // eslint-disable-next-line no-console
  console.log(`  ${name}: mean=${mean.toFixed(3)}ms min=${min.toFixed(3)}ms max=${max.toFixed(3)}ms (n=${samples.length})`);
  return { mean, min, max, count: samples.length };
}

describe("Performance baseline", () => {
  let createApp: typeof import("../../src/app.js").createApp;
  let createPokemon: typeof import("../../src/game/pokemon-factory.js").createPokemon;
  let generateTowerParty: typeof import("../../src/game/tower-ai.js").generateTowerParty;
  let getPokedex: typeof import("../../src/game/data-loader.js").getSpecies;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = path.join(os.tmpdir(), `pokelog-bench-${randomUUID()}`);
    fs.mkdirSync(path.join(dataDir, "users"), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        meta: { name: "Bench", region: "kanto" },
        polling: { intervalMinutes: 5 },
        rewards: {
          expPerByte: 0.01,
          pointsPerByte: 0.005,
          encounter: { baseChance: 0.3, ceilingBytes: 1000, timeLimitHours: 168 },
        },
      }),
    );
    process.env.POKELOG_DATA_DIR = dataDir;

    const [{ createApp: ca }, { createPokemon: cp }, { generateTowerParty: gtp }, { getSpecies }] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/game/pokemon-factory.js"),
      import("../../src/game/tower-ai.js"),
      import("../../src/game/data-loader.js"),
    ]);
    createApp = ca;
    createPokemon = cp;
    generateTowerParty = gtp;
    getPokedex = getSpecies;
    // Warm data loader caches.
    getPokedex();
  });

  afterAll(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.POKELOG_DATA_DIR;
  });

  it("createApp() startup under 250ms mean", () => {
    const stats = bench("createApp", 10, () => {
      createApp();
    });
    expect(stats.mean).toBeLessThan(250);
  });

  it("createPokemon(pikachu, lv 50) under 5ms mean", () => {
    const stats = bench("createPokemon pikachu lv50", 200, () => {
      createPokemon("pikachu", 50);
    });
    expect(stats.mean).toBeLessThan(5);
  });

  it("createPokemon(charizard, lv 50) under 5ms mean", () => {
    const stats = bench("createPokemon charizard lv50", 200, () => {
      createPokemon("charizard", 50);
    });
    expect(stats.mean).toBeLessThan(5);
  });

  it("generateTowerParty stage 1 under 100ms mean", () => {
    const stats = bench("generateTowerParty stage=1", 30, () => {
      generateTowerParty(1);
    });
    expect(stats.mean).toBeLessThan(100);
  });

  it("generateTowerParty stage 50 under 100ms mean", () => {
    const stats = bench("generateTowerParty stage=50", 30, () => {
      generateTowerParty(50);
    });
    expect(stats.mean).toBeLessThan(100);
  });

  it("generateTowerParty stage 100 under 100ms mean", () => {
    const stats = bench("generateTowerParty stage=100", 30, () => {
      generateTowerParty(100);
    });
    expect(stats.mean).toBeLessThan(100);
  });

  it("getSpecies() pokedex load (cached) under 1ms mean", () => {
    const stats = bench("getSpecies cached", 100, () => {
      getPokedex();
    });
    expect(stats.mean).toBeLessThan(1);
  });
});
