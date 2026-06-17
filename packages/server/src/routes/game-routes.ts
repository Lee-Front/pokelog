import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { getAllSpecies, createWildPokemon } from "../game/pokemon-factory.js";
import { selectWildPokemon, scaleWildLevel } from "../game/encounter.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { getRegion, getRegionNames, getSpeciesByName } from "../game/data-loader.js";
import { buildLevelEvolutionContext, getEvolutionBranchDiagnostics } from "../game/growth.js";
import { findPokemonByUid, getPartyPokemon } from "../game/pokemon-state.js";
import { getAnnouncements } from "../storage/announcement-store.js";
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
    // 응답 시점에 종족 속성(types)을 덧붙인다 — 저장 데이터(WildPokemon)에는 없고,
    // 웹의 속성 필터에만 쓰이므로 마이그레이션 없이 종족 데이터에서 계산한다.
    const eventsWithTypes = activeEvents.map((e) => ({
      ...e,
      pokemon: {
        ...e.pokemon,
        types: getSpeciesByName(e.pokemon.species)?.types ?? [],
      },
    }));
    res.json({
      events: eventsWithTypes,
      // 웹/CLI가 "포인트로 탐색" UI를 그릴 수 있도록 비용과 잔액을 함께 내려준다.
      searchCost: config.rewards.encounter.searchCost,
      points: user.points,
    });
  } catch (err) {
    log.error({ err }, "Events error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 야생 조우 이벤트 삭제(dismiss) — 사용자가 관심 없는 야생을 목록에서 치운다.
// battle-routes의 pendingEvents 정리 패턴과 동일하게 id로 걸러낸다.
gameRoutes.delete("/events/:id", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const { id } = req.params;
    const before = user.pendingEvents.length;
    user.pendingEvents = user.pendingEvents.filter((e) => e.id !== id);
    if (user.pendingEvents.length === before) {
      res.status(404).json({ error: "이벤트를 찾을 수 없습니다" });
      return;
    }

    await saveUser(user);
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Event delete error");
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
    const partyLevels = getPartyPokemon(user).map((p) => p.level);
    const wildLevel = scaleWildLevel(pick.level, partyLevels, pick.minLevel);
    const wildPokemon = createWildPokemon(pick.species, wildLevel);
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
    // getEvolutionBranchDiagnostics already resolves a variant-aware targetName
    // (the form's name when a branch evolves into a variant), so use it directly.
    const evolutionPreview = getEvolutionBranchDiagnostics(pokemon.species, {
      level: pokemon.level,
      ...buildLevelEvolutionContext(pokemon, activeParty, {
        region: user.currentRegion ?? "default",
      }),
    });

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

// 현재 활성(active)이면서 이 유저가 아직 닫지(dismiss) 않은 공지 목록.
gameRoutes.get("/announcements/active", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const dismissed = new Set(user.dismissedAnnouncementIds ?? []);
    const active = (await getAnnouncements()).filter((a) => a.active && !dismissed.has(a.id));
    res.json({ announcements: active });
  } catch (err) {
    log.error({ err }, "Active announcements error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 공지 닫기 — 유저 데이터에 dismiss 기록(중복 추가 안 함). 존재하지 않는 id도 멱등 허용.
gameRoutes.post("/announcements/:id/dismiss", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const dismissed = user.dismissedAnnouncementIds ?? [];
    if (!dismissed.includes(req.params.id)) {
      dismissed.push(req.params.id);
      user.dismissedAnnouncementIds = dismissed;
      await saveUser(user);
    }
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Dismiss announcement error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
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
