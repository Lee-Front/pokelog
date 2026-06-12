import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { getAllSpecies, createWildPokemon } from "../game/pokemon-factory.js";
import { selectWildPokemon } from "../game/encounter.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { getRegion, getRegionNames, getSpeciesByName } from "../game/data-loader.js";
import { buildLevelEvolutionContext, getEvolutionBranchDiagnostics } from "../game/growth.js";
import { findPokemonByUid, getPartyPokemon } from "../game/pokemon-state.js";
import { childLogger } from "../logger.js";
const log = childLogger("game-routes");

const MAX_PARTY_SIZE = 6;

export const gameRoutes = Router();
gameRoutes.use(authMiddleware);

gameRoutes.get("/status", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const now = new Date();
    const pendingCount = user.pendingEvents.filter(
      (e) => new Date(e.expiresAt) > now,
    ).length;

    const today = now.toISOString().slice(0, 10);
    const todayLogs = user.log.filter((l) => l.timestamp.startsWith(today));

    res.json({
      nickname: user.account.nickname,
      points: user.points,
      totalExp: user.totalExp,
      combo: user.combo,
      pendingEventCount: pendingCount,
      pendingEvolutionCount: user.pendingEvolutions?.length ?? 0,
      todayLog: todayLogs,
      region: (() => { try { return getRegion(user.currentRegion ?? "default").name; } catch { return user.currentRegion ?? "default"; } })(),
    });
  } catch (err) {
    log.error({ err }, "Status error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/events", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const now = new Date();
    const activeEvents = user.pendingEvents.filter(
      (e) => new Date(e.expiresAt) > now,
    );

    // 만료된 이벤트 정리
    if (activeEvents.length !== user.pendingEvents.length) {
      user.pendingEvents = activeEvents;
      await saveUser(user);
    }

    const config = await getConfig();
    res.json({
      events: activeEvents,
      // 웹/CLI가 "포인트로 탐색" UI를 그릴 수 있도록 비용과 잔액을 함께 내려준다.
      searchCost: config.rewards.encounter.searchCost,
      points: user.points,
    });
  } catch (err) {
    log.error({ err }, "Events error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 포인트를 소비해 현재 지역에서 야생 포켓몬을 즉시 탐색(조우 생성)한다.
gameRoutes.post("/wild/search", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const config = await getConfig();
    const cost = config.rewards.encounter.searchCost;
    if (user.points < cost) {
      res.status(400).json({ error: `포인트가 부족합니다 (필요: ${cost}P)` });
      return;
    }

    const regionData = getRegion(user.currentRegion ?? "default");
    const pick = selectWildPokemon(regionData);
    const wildPokemon = createWildPokemon(pick.species, pick.level);
    const event = createEncounterEvent(wildPokemon, config.rewards.encounter.timeLimitHours);

    user.points -= cost;
    user.pendingEvents.push(event);
    await saveUser(user);

    res.status(201).json({ event, cost, remainingPoints: user.points });
  } catch (err) {
    log.error({ err }, "Wild search error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/history", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20) || 20));
    const recent = [...user.log]
      .slice(-limit)
      .reverse()
      .map((entry) => ({
        timestamp: entry.timestamp,
        source: getLogSource(entry),
        type: entry.type,
        points: Number(entry.points ?? 0),
        exp: Number(entry.exp ?? 0),
        summary: getLogSummary(entry),
      }));

    const totals = user.log.reduce<Record<string, { points: number; exp: number; count: number }>>((acc, entry) => {
      const source = getLogSource(entry);
      if (!acc[source]) {
        acc[source] = { points: 0, exp: 0, count: 0 };
      }
      acc[source].points += Number(entry.points ?? 0);
      acc[source].exp += Number(entry.exp ?? 0);
      acc[source].count += 1;
      return acc;
    }, {});

    res.json({ totals, recent });
  } catch (err) {
    log.error({ err }, "History error");
    res.status(500).json({ error: "이력을 불러오지 못했습니다" });
  }
});

gameRoutes.get("/party", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const partyPokemon = getPartyPokemon(user);

    res.json({ party: partyPokemon });
  } catch (err) {
    log.error({ err }, "Party error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.put("/party", async (req: AuthRequest, res: Response) => {
  try {
    const { uids } = req.body;
    if (!Array.isArray(uids) || uids.length === 0) {
      res.status(400).json({ error: "파티 포켓몬을 선택해주세요" });
      return;
    }

    if (uids.length > MAX_PARTY_SIZE) {
      res.status(400).json({ error: `파티는 최대 ${MAX_PARTY_SIZE}마리입니다` });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const allUids = user.pokemon.map((p) => p.uid);
    const invalid = uids.filter((uid: string) => !allUids.includes(uid));
    if (invalid.length > 0) {
      res.status(400).json({ error: "존재하지 않는 포켓몬이 포함되어 있습니다" });
      return;
    }

    user.party = uids;
    await saveUser(user);
    res.json({ party: uids });
  } catch (err) {
    log.error({ err }, "Party update error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/pokemon/:uid", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const pokemon = findPokemonByUid(user, req.params.uid);

    if (!pokemon) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    const activeParty = getPartyPokemon(user);
    const evolutionPreview = getEvolutionBranchDiagnostics(pokemon.species, {
      level: pokemon.level,
      ...buildLevelEvolutionContext(pokemon, activeParty, {
        region: user.currentRegion ?? "default",
      }),
    }).map((branch) => ({
      ...branch,
      targetName: getSpeciesByName(branch.targetSpecies)?.name ?? branch.targetSpecies,
    }));

    res.json({ pokemon, evolutionPreview });
  } catch (err) {
    log.error({ err }, "Pokemon detail error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/pokedex", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const caughtSpecies = new Set([
      ...user.pokemon.map((p) => p.species),
      ...user.storage.map((p) => p.species),
    ]);

    res.json({
      seen: user.pokedex,
      caught: [...caughtSpecies],
      allSpecies: getAllSpecies(),
    });
  } catch (err) {
    log.error({ err }, "Pokedex error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/regions", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.json({
      currentRegion: user.currentRegion ?? "default",
      regions: getRegionNames().map((regionId) => {
        const region = getRegion(regionId);
        return {
          id: regionId,
          name: region.name,
        };
      }),
    });
  } catch (err) {
    log.error({ err }, "Region list error");
    res.status(500).json({ error: "Failed to load regions." });
  }
});

gameRoutes.put("/region", async (req: AuthRequest, res: Response) => {
  try {
    const region = String(req.body.region ?? "").trim();
    if (!region) {
      res.status(400).json({ error: "region is required." });
      return;
    }
    if (!getRegionNames().includes(region)) {
      res.status(404).json({ error: "Region not found." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    user.currentRegion = region;
    await saveUser(user);

    res.json({
      currentRegion: region,
      regionName: getRegion(region).name,
    });
  } catch (err) {
    log.error({ err }, "Region update error");
    res.status(500).json({ error: "Failed to update region." });
  }
});

function getLogSource(entry: Record<string, unknown>): string {
  if (entry.type === "integration_reward") {
    return String(entry.provider ?? "integration");
  }
  if (entry.type === "reward") {
    return "git";
  }
  return String(entry.type ?? "other");
}

function getLogSummary(entry: Record<string, unknown>): string {
  if (entry.type === "integration_reward") {
    return String(entry.summary ?? entry.eventKey ?? "integration reward");
  }
  if (entry.type === "reward") {
    const repo = String(entry.repo ?? "repo");
    const bytes = Number(entry.bytes ?? 0);
    return `${repo} / ${bytes} bytes`;
  }
  return String(entry.type ?? "activity");
}
