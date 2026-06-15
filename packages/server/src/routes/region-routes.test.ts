import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { aggregateEncounters, findSpeciesRegions, regionRoutes } from "./region-routes.js";
import type { RegionData } from "../../../../shared/types.js";

function makeApp() {
  const app = express();
  app.use("/api", regionRoutes);
  return app;
}

describe("aggregateEncounters", () => {
  it("종별로 레벨 범위를 통합하고 weight를 합산한다", () => {
    const encounters: RegionData["encounters"] = [
      { species: "pidgey", weight: 30, levelRange: [2, 4] },
      { species: "pidgey", weight: 10, levelRange: [5, 7] },
      { species: "rattata", weight: 20, levelRange: [3, 5] },
    ];

    const result = aggregateEncounters(encounters);
    const pidgey = result.find((e) => e.species === "pidgey")!;

    expect(pidgey.minLevel).toBe(2);
    expect(pidgey.maxLevel).toBe(7);
    expect(pidgey.weight).toBe(40);
  });

  it("weight 내림차순으로 정렬한다", () => {
    const encounters: RegionData["encounters"] = [
      { species: "rare", weight: 5, levelRange: [10, 12] },
      { species: "common", weight: 50, levelRange: [2, 4] },
      { species: "mid", weight: 20, levelRange: [5, 8] },
    ];

    const result = aggregateEncounters(encounters);
    expect(result.map((e) => e.species)).toEqual(["common", "mid", "rare"]);
  });

  it("rarityPct는 전체 weight 대비 비율이며 합이 100에 수렴한다", () => {
    const encounters: RegionData["encounters"] = [
      { species: "a", weight: 25, levelRange: [1, 3] },
      { species: "b", weight: 75, levelRange: [1, 3] },
    ];

    const result = aggregateEncounters(encounters);
    const a = result.find((e) => e.species === "a")!;
    const b = result.find((e) => e.species === "b")!;

    expect(a.rarityPct).toBeCloseTo(25);
    expect(b.rarityPct).toBeCloseTo(75);
    const sum = result.reduce((s, e) => s + e.rarityPct, 0);
    expect(sum).toBeCloseTo(100);
  });

  it("빈 목록은 빈 배열을 반환한다", () => {
    expect(aggregateEncounters([])).toEqual([]);
  });
});

describe("GET /regions", () => {
  it("지역 목록을 { id, name }으로 반환한다", async () => {
    const res = await request(makeApp()).get("/api/regions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const region of res.body) {
      expect(typeof region.id).toBe("string");
      expect(typeof region.name).toBe("string");
    }
    expect(res.body.some((r: { id: string }) => r.id === "kanto")).toBe(true);
  });
});

describe("GET /regions/:id", () => {
  it("집계된 출몰 목록을 반환한다(정렬·rarityPct 합 ≈ 100)", async () => {
    const res = await request(makeApp()).get("/api/regions/kanto");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("kanto");
    expect(typeof res.body.name).toBe("string");
    expect(Array.isArray(res.body.encounters)).toBe(true);
    expect(res.body.encounters.length).toBeGreaterThan(0);

    const encounters = res.body.encounters as Array<{
      species: string;
      minLevel: number;
      maxLevel: number;
      weight: number;
      rarityPct: number;
    }>;

    // weight 내림차순 정렬 검증
    for (let i = 1; i < encounters.length; i++) {
      expect(encounters[i - 1].weight).toBeGreaterThanOrEqual(encounters[i].weight);
    }
    // 종별 집계이므로 중복 종이 없어야 한다
    const species = encounters.map((e) => e.species);
    expect(new Set(species).size).toBe(species.length);
    // rarityPct 합은 100에 수렴
    const sum = encounters.reduce((s, e) => s + e.rarityPct, 0);
    expect(sum).toBeCloseTo(100);
  });

  it("잘못된 지역 id는 404", async () => {
    const res = await request(makeApp()).get("/api/regions/atlantis");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});

describe("findSpeciesRegions", () => {
  const regions = [
    {
      id: "kanto",
      name: "Kanto",
      encounters: [
        { species: "pikachu", minLevel: 3, maxLevel: 5, weight: 5, rarityPct: 5 },
        { species: "pidgey", minLevel: 2, maxLevel: 4, weight: 50, rarityPct: 50 },
      ],
    },
    {
      id: "johto",
      name: "Johto",
      encounters: [
        { species: "pikachu", minLevel: 10, maxLevel: 12, weight: 30, rarityPct: 30 },
      ],
    },
  ];

  it("종이 출몰하는 지역만 레벨범위·희귀도와 함께 추린다", () => {
    const result = findSpeciesRegions("pikachu", regions);
    expect(result.map((r) => r.id)).toEqual(["johto", "kanto"]); // rarityPct 내림차순
    const johto = result.find((r) => r.id === "johto")!;
    expect(johto.minLevel).toBe(10);
    expect(johto.maxLevel).toBe(12);
    expect(johto.rarityPct).toBe(30);
  });

  it("어떤 지역에도 없는 종은 빈 배열", () => {
    expect(findSpeciesRegions("mewtwo", regions)).toEqual([]);
  });
});

describe("GET /regions/of/:species", () => {
  it("종이 출몰하는 지역 목록을 반환한다", async () => {
    const res = await request(makeApp()).get("/api/regions/of/pidgey");
    expect(res.status).toBe(200);
    expect(res.body.species).toBe("pidgey");
    expect(Array.isArray(res.body.regions)).toBe(true);
    // pidgey가 나오는 지역이 최소 1곳(kanto)은 있어야 한다
    expect(res.body.regions.some((r: { id: string }) => r.id === "kanto")).toBe(true);
    for (const r of res.body.regions) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.name).toBe("string");
      expect(typeof r.minLevel).toBe("number");
      expect(typeof r.maxLevel).toBe("number");
      expect(typeof r.rarityPct).toBe("number");
    }
  });

  it("어떤 지역에도 없는 종은 빈 목록(200)", async () => {
    const res = await request(makeApp()).get("/api/regions/of/nonexistentmon");
    expect(res.status).toBe(200);
    expect(res.body.regions).toEqual([]);
  });

  it("/regions/:id 보다 먼저 매칭되어 'of'가 지역 id로 잡히지 않는다", async () => {
    const res = await request(makeApp()).get("/api/regions/of/pikachu");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("species", "pikachu");
    expect(res.body).not.toHaveProperty("encounters");
  });
});
