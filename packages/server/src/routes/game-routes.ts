import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { getAllSpecies, createWildPokemon, createPokemon } from "../game/pokemon-factory.js";
import { selectFromEncounters, splitEncounters } from "../game/encounter.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { getRegion, getRegionNames, getSpeciesByName } from "../game/data-loader.js";
import { buildLevelEvolutionContext, getEvolutionBranchDiagnostics } from "../game/growth.js";
import { getAvailableEvolutionOptions, prunePendingEvolutions } from "../game/pending-evolution.js";
import { findPokemonByUid, getPartyPokemon } from "../game/pokemon-state.js";
import { getAnnouncements } from "../storage/announcement-store.js";
import { childLogger } from "../logger.js";
const log = childLogger("game-routes");

const MAX_PARTY_SIZE = 6;

export const gameRoutes = Router();
gameRoutes.use(authMiddleware);

const VALID_STARTERS = ["bulbasaur", "charmander", "squirtle"];

// 스타터 선택 — 게임 리셋(또는 미초기화) 등으로 포켓몬이 0마리인 계정만 스타터를 받는다.
// 가입과 동일하게 Lv.5 스타터 + 몬스터볼 5개를 지급하고 도감에 등록한다(멱등: 이미 보유 시 거부).
gameRoutes.post("/starter", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const starter = typeof req.body?.starter === "string" ? req.body.starter : "";
    if (!VALID_STARTERS.includes(starter)) {
      res.status(400).json({ error: "올바른 스타터를 선택해주세요 (bulbasaur, charmander, squirtle)" });
      return;
    }

    // 이미 포켓몬이 있으면 스타터를 다시 줄 수 없다(중복 지급 방지).
    if ((user.pokemon?.length ?? 0) > 0 || (user.party?.length ?? 0) > 0) {
      res.status(400).json({ error: "이미 포켓몬을 보유하고 있어 스타터를 받을 수 없습니다." });
      return;
    }

    const starterPokemon = createPokemon(starter, 5);
    user.pokemon = [starterPokemon];
    user.party = [starterPokemon.uid];
    if (!user.pokedex.includes(starter)) user.pokedex.push(starter);
    user.inventory.pokeball = (user.inventory.pokeball ?? 0) + 5;

    await saveUser(user);
    res.json({ ok: true, pokemon: starterPokemon });
  } catch (err) {
    log.error({ err }, "Starter selection error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/status", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const now = new Date();
    // 야생 조우는 만료되지 않으므로 대기 이벤트 전체가 곧 활성 개수다.
    const pendingCount = user.pendingEvents.length;

    // 더 이상 진화를 자동으로 큐잉하지 않는다 — 진화는 플레이어가 목록/상세에서 명시적으로
    // 요청하는 온디맨드 경로(POST /game/pokemon/:uid/evolve)로 옮겼다. 다만 과거 자동 큐잉으로
    // 존재하지 않는 대상 종에 잘못 쌓였던 기존 유저의 잔여 pending만 여기서 마이그레이션 삼아 정리한다.
    const prunedCount = prunePendingEvolutions(user);
    if (prunedCount > 0) {
      await saveUser(user);
    }

    const today = now.toISOString().slice(0, 10);
    const todayLogs = user.log.filter((l) => l.timestamp.startsWith(today));

    res.json({
      nickname: user.account.nickname,
      points: user.points,
      totalExp: user.totalExp,
      combo: user.combo,
      pendingEventCount: pendingCount,
      pendingEvolutionCount: user.pendingEvolutions?.length ?? 0,
      pendingMoveLearnCount: user.pendingMoveLearns?.length ?? 0,
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

    // 야생 조우는 만료되지 않으므로 대기 이벤트를 그대로 내려준다.
    // 응답 시점에 종족 속성(types)을 덧붙인다 — 저장 데이터(WildPokemon)에는 없고,
    // 웹의 속성 필터에만 쓰이므로 마이그레이션 없이 종족 데이터에서 계산한다.
    const eventsWithTypes = user.pendingEvents.map((e) => ({
      ...e,
      pokemon: {
        ...e.pokemon,
        types: getSpeciesByName(e.pokemon.species)?.types ?? [],
      },
    }));
    res.json({
      events: eventsWithTypes,
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

// 무료 일괄 야생 롤 — 현재 지역 풀에서 rollCount(기본 12)마리를 한 번에 생성해
// 야생 보드를 통째로 교체한다(기존 wild_encounter 제거, 다른 pending 이벤트는 유지).
// 포인트 차감 없음(무료). 포털은 이 응답을 받아 슬롯 롤 애니메이션 후 일괄 공개한다.
gameRoutes.post("/wild/search", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const config = await getConfig();
    const rollCount = config.rewards.encounter.rollCount;
    const regionData = getRegion(user.currentRegion ?? "default");

    // 야생 레벨 파티 스케일링 — 파티 최고 레벨 기준 ±variance로 뽑는다(플래그 켜짐 + 파티 보유 시).
    // 종 선택은 그대로(가중 추첨)이고 레벨만 스케일된다. 파티가 비었으면 undefined로 둬서 지역
    // levelRange 균등 롤(종 자연 레벨대)로 폴백한다.
    const party = getPartyPokemon(user);
    const partyMaxLevel = party.reduce((max, p) => Math.max(max, p.level), 0);
    const scaling = config.battle.wildLevelScaling && partyMaxLevel > 0
      ? { partyMaxLevel, variance: config.battle.wildLevelVariance }
      : undefined;

    // 전설/환상은 일반 가중 추첨에서 제외한다 — 일반 풀에서만 rollCount 배치를 뽑는다.
    const { normal: normalPool, legendary: legendaryPool } = splitEncounters(regionData);

    // rollCount만큼 일반 조우를 생성한다.
    const newBatch = Array.from({ length: rollCount }, () => {
      const pick = selectFromEncounters(normalPool, Math.random, scaling);
      const wildPokemon = createWildPokemon(pick.species, pick.level);
      return createEncounterEvent(wildPokemon);
    });

    // 게이팅된 전설 주입 — 롤 1회당 확률적으로 슬롯 하나를 지역 전설로 교체한다(최대 1마리, 쿨다운 없음).
    // 전설도 레벨은 스케일되지만 자기 levelRange[0] 하한으로 클램프돼 밴드 아래로는 내려가지 않는다.
    if (legendaryPool.length && Math.random() < config.rewards.encounter.wildLegendaryChance) {
      const pick = selectFromEncounters(legendaryPool, Math.random, scaling);
      const legendary = createEncounterEvent(createWildPokemon(pick.species, pick.level));
      const slot = Math.floor(Math.random() * newBatch.length);
      newBatch[slot] = legendary;
    }

    // 보드 교체 — 기존 야생 조우는 제거하되 진화/기술배우기 등 다른 pending은 보존한다.
    user.pendingEvents = user.pendingEvents
      .filter((e) => e.type !== "wild_encounter")
      .concat(newBatch);
    await saveUser(user);

    res.status(200).json({ events: newBatch, count: newBatch.length });
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

    const party = getPartyPokemon(user);
    const region = user.currentRegion ?? "default";
    // 계산 전용(비영속) 진화 가능 여부/선택지를 부착한다. 저장 객체를 변형하지 않도록 반드시
    // 스프레드 복제본에만 얹는다(user.pokemon 참조를 직접 건드리면 saveUser에 새 필드가 샌다).
    const withEvolution = party.map((p) => {
      const options = getAvailableEvolutionOptions(user, p, { region });
      return { ...p, evolutionAvailable: options.length > 0, evolutionOptions: options };
    });

    res.json({ party: withEvolution });
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

    // caught/seen은 영구 집합(user-store가 단조 유지). 현재 보유에서 파생하면 방생 시 사라지므로 금지.
    res.json({
      seen: user.seenSpecies ?? user.pokedex,
      caught: user.pokedex,
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
