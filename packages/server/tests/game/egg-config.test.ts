import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { clearAllCaches } from "../../src/game/data-loader.js";
import { clearEggGachaCache, getEggTierPool, getEggTierSummaries, hatchEgg } from "../../src/game/egg-gacha.js";
import { getConfig } from "../../src/storage/config-store.js";
import { DEFAULT_SHINY_RATE, getShinyRate } from "../../src/game/shiny.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";

// 격리된 임시 데이터 디렉토리에 config.json을 직접 써서 egg/shiny 설정 적용을 검증한다.
let dataDir: string;

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config));
}

beforeEach(() => {
  dataDir = path.join(os.tmpdir(), `pokelog-eggcfg-${randomUUID()}`);
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.POKELOG_DATA_DIR = dataDir;
  clearAllCaches();
  clearEggGachaCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  delete process.env.POKELOG_DATA_DIR;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("egg config application", () => {
  it("falls back to default tier cost/level when config.json is absent", async () => {
    const summaries = await getEggTierSummaries();
    expect(summaries.map((s) => s.cost)).toEqual([120, 450, 3200]);
  });

  it("applies admin-edited tier cost from config.json", async () => {
    writeConfig({ egg: { common: { cost: 999 } } });
    const summaries = await getEggTierSummaries();
    const common = summaries.find((s) => s.tier === "common");
    expect(common!.cost).toBe(999);
    // 편집하지 않은 티어는 기본값으로 폴백
    expect(summaries.find((s) => s.tier === "rare")!.cost).toBe(450);
  });

  it("uses admin-edited level range for hatched level", async () => {
    writeConfig({ egg: { common: { minLevel: 42, maxLevel: 42 } } });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = await hatchEgg({ id: "e", tier: "common", createdAt: new Date().toISOString() });
    expect(result.pokemon.level).toBe(42);
  });

  it("scales pool weights by weightMultiplier (relative ratio preserved)", async () => {
    const baseline = await getEggTierPool("common");
    const baseEntry = baseline.find((e) => e.species === "diglett")!;

    writeConfig({ egg: { common: { weightMultiplier: 3 } } });
    clearEggGachaCache();
    const scaled = await getEggTierPool("common");
    const scaledEntry = scaled.find((e) => e.species === "diglett")!;

    // 배수만큼 커지되 floor(1)·반올림 오차 범위 내
    expect(scaledEntry.weight).toBeGreaterThan(baseEntry.weight);
    expect(scaledEntry.weight).toBe(Math.max(1, Math.round(baseEntry.weight * 3)));
  });
});

describe("shiny rate config", () => {
  it("defaults to 1/4096 when config has no shinyRate", async () => {
    await getConfig();
    expect(getShinyRate()).toBe(DEFAULT_SHINY_RATE);
  });

  it("refreshes the cached shiny rate from config and applies it in createPokemon", async () => {
    writeConfig({ shinyRate: 1 });
    await getConfig(); // funnel이 캐시 갱신
    expect(getShinyRate()).toBe(1);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const mon = createPokemon("pikachu", 5);
    expect(mon.isShiny).toBe(true); // 0.5 < 1
  });

  it("falls back to default for out-of-range shinyRate", async () => {
    writeConfig({ shinyRate: 5 });
    await getConfig();
    expect(getShinyRate()).toBe(DEFAULT_SHINY_RATE);
  });
});
