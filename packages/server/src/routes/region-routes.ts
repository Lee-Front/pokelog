import { Router } from "express";
import type { Request, Response } from "express";
import type { RegionData } from "../../../../shared/types.js";
import { getRegion, getRegionNames } from "../game/data-loader.js";
import { childLogger } from "../logger.js";

const log = childLogger("region-routes");

/** 종별 집계된 출몰 정보 — 레벨 범위 통합 + 희귀도(%) 포함. */
export interface AggregatedEncounter {
  species: string;
  minLevel: number;
  maxLevel: number;
  weight: number;
  rarityPct: number;
}

/**
 * 지역의 raw encounter 목록을 종별로 집계한다.
 * 같은 종이 여러 entry로 등장할 수 있으므로 레벨 범위를 min/max로 통합하고
 * weight를 합산한다. rarityPct는 종 weight합 / 전체 weight합 * 100이며,
 * weight 내림차순(흔한 종부터)으로 정렬해 반환한다.
 */
export function aggregateEncounters(encounters: RegionData["encounters"]): AggregatedEncounter[] {
  const totalWeight = encounters.reduce((sum, e) => sum + e.weight, 0);
  const bySpecies = new Map<string, { minLevel: number; maxLevel: number; weight: number }>();

  for (const entry of encounters) {
    const [minLevel, maxLevel] = entry.levelRange;
    const existing = bySpecies.get(entry.species);
    if (existing) {
      existing.minLevel = Math.min(existing.minLevel, minLevel);
      existing.maxLevel = Math.max(existing.maxLevel, maxLevel);
      existing.weight += entry.weight;
    } else {
      bySpecies.set(entry.species, { minLevel, maxLevel, weight: entry.weight });
    }
  }

  return Array.from(bySpecies.entries())
    .map(([species, agg]) => ({
      species,
      minLevel: agg.minLevel,
      maxLevel: agg.maxLevel,
      weight: agg.weight,
      rarityPct: totalWeight > 0 ? (agg.weight / totalWeight) * 100 : 0,
    }))
    .sort((a, b) => b.weight - a.weight || a.species.localeCompare(b.species));
}

/** 어떤 종이 출몰하는 단일 지역 정보 — 그 지역에서의 레벨범위·희귀도. */
export interface SpeciesRegionAppearance {
  id: string;
  name: string;
  minLevel: number;
  maxLevel: number;
  rarityPct: number;
}

/**
 * 종 → 출몰 지역 역조회. 전체 지역의 집계 결과를 받아, 주어진 종이 등장하는 지역만
 * 추려 그 지역에서의 레벨범위·희귀도를 돌려준다. 희귀도(rarityPct)가 높은 지역(흔한 곳)
 * 부터, 동률이면 지역 id 순으로 정렬한다. 데이터 로딩과 분리해 단위 테스트할 수 있게 export.
 */
export function findSpeciesRegions(
  species: string,
  regions: Array<{ id: string; name: string; encounters: AggregatedEncounter[] }>,
): SpeciesRegionAppearance[] {
  const appearances: SpeciesRegionAppearance[] = [];
  for (const region of regions) {
    const match = region.encounters.find((e) => e.species === species);
    if (match) {
      appearances.push({
        id: region.id,
        name: region.name,
        minLevel: match.minLevel,
        maxLevel: match.maxLevel,
        rarityPct: match.rarityPct,
      });
    }
  }
  return appearances.sort((a, b) => b.rarityPct - a.rarityPct || a.id.localeCompare(b.id));
}

export const regionRoutes = Router();

// 지역 목록 — 정적 공개 데이터(인증 불필요)
regionRoutes.get("/regions", (_req: Request, res: Response) => {
  try {
    const regions = getRegionNames().map((id) => ({ id, name: getRegion(id).name }));
    res.json(regions);
  } catch (err) {
    log.error({ err }, "Region list error");
    res.status(500).json({ error: "Failed to load regions." });
  }
});

// 종 → 출몰 지역 역조회 — /:id 보다 먼저 등록해야 "of"가 id로 잡히지 않는다.
// 어떤 지역에서도 안 나오는 종(또는 미존재 종)은 빈 목록(200)으로 응답한다.
regionRoutes.get("/regions/of/:species", (req: Request, res: Response) => {
  const species = req.params.species;
  try {
    const regions = getRegionNames()
      .map((id) => {
        // 일부 지역 파일이 깨졌어도(빈 encounters 등) 전체 조회가 실패하지 않도록 건너뛴다.
        try {
          const region = getRegion(id);
          return { id, name: region.name, encounters: aggregateEncounters(region.encounters) };
        } catch {
          return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    res.json({ species, regions: findSpeciesRegions(species, regions) });
  } catch (err) {
    log.error({ err }, "Species region lookup error");
    res.status(500).json({ error: "Failed to look up species regions." });
  }
});

// 지역별 출몰 포켓몬(종별 집계) — 잘못된 id는 404
regionRoutes.get("/regions/:id", (req: Request, res: Response) => {
  const id = req.params.id;
  try {
    const region = getRegion(id);
    res.json({
      id,
      name: region.name,
      encounters: aggregateEncounters(region.encounters),
    });
  } catch {
    res.status(404).json({ error: `Region not found: ${id}` });
  }
});
