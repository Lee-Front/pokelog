import { Router } from "express";
import type { Response } from "express";
import crypto from "node:crypto";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withLock } from "../storage/pvp-store.js";
import { getConfig } from "../storage/config-store.js";
import { getAllSpecies, createWildPokemon, createPokemon } from "../game/pokemon-factory.js";
import { selectFromEncounters, splitEncounters } from "../game/encounter.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { getRegion, getRegionNames, getSpeciesByName, getAbilityById, isWildSpecies, regionSpeciesList } from "../game/data-loader.js";
import { rollRegionEncounters } from "../game/wild-roll.js";
import { startWildBattle } from "./battle-routes.js";
import { buildLevelEvolutionContext, getEvolutionBranchDiagnostics, getAllLearnableMoves, setPokemonMoves, tunePokemon } from "../game/growth.js";
import { getAvailableEvolutionOptions, prunePendingEvolutions } from "../game/pending-evolution.js";
import { findPokemonByUid, getPartyPokemon, getDisplaySpeciesName } from "../game/pokemon-state.js";
import { GameRuleError } from "../game/game-errors.js";
import { getAnnouncements } from "../storage/announcement-store.js";
import { evaluateAchievements } from "../game/achievements.js";
import { TITLES, evaluateTitles } from "../game/titles.js";
import { getStats } from "../storage/pvp-stats-store.js";
import { getCompletedTradeCount } from "../storage/trade-store.js";
import {
  buildBossWild, computeBossLevel, getCurrentBoss, getIsoWeek, getIsoWeekLabel,
  HELD_ITEM_EFFECT_KO,
} from "../game/weekly-boss.js";
import { getClears, RANK_POINTS, PARTICIPATION_POINTS } from "../storage/boss-clears-store.js";
import { defaultStatStages } from "../game/battle.js";
import { applySwitchInAbilities } from "../game/abilities.js";
import { applyImposterOnSwitchIn } from "../game/battle-state.js";
import { checkPrimalReversion, getTransformedStats } from "../game/battle-transformations.js";
import { appendEvent } from "../storage/event-log.js";
import { wildPokemonToOwned } from "../game/pokemon-factory.js";
import { resolveShopItem } from "../game/inventory-utils.js";
import {
  getWorldBoss, mutateWorldBoss, endWorldBossIfExpired, CHAT_MAX,
} from "../storage/world-boss-store.js";
import type { BattleState, OwnedPokemon, WorldBossState } from "../../../../shared/types.js";
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
    await withLock(`user:${req.userId!}`, async () => {
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
    });
  } catch (err) {
    log.error({ err }, "Starter selection error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/status", async (req: AuthRequest, res: Response) => {
  try {
    await withLock(`user:${req.userId!}`, async () => {
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
    await withLock(`user:${req.userId!}`, async () => {
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
    });
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
    await withLock(`user:${req.userId!}`, async () => {
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
      // levelRange 균등 롤(종 자연 레벨대)로 폴백한다. (전설 주입용 scaling만 여기서 계산 — 일반
      // 풀 배치는 rollRegionEncounters가 동일 로직으로 자체 계산한다.)
      const party = getPartyPokemon(user);
      const partyMaxLevel = party.reduce((max, p) => Math.max(max, p.level), 0);
      const scaling = config.battle.wildLevelScaling && partyMaxLevel > 0
        ? { partyMaxLevel, variance: config.battle.wildLevelVariance }
        : undefined;

      // rollCount만큼 일반 조우를 생성한다(자동 탐색과 공유하는 순수 롤 함수).
      const newBatch = await rollRegionEncounters(user, rollCount);

      // 게이팅된 전설 주입(수동 전용) — 롤 1회당 확률적으로 슬롯 하나를 지역 전설로 교체한다(최대 1마리, 쿨다운 없음).
      // 전설도 레벨은 스케일되지만 자기 levelRange[0] 하한으로 클램프돼 밴드 아래로는 내려가지 않는다.
      const { legendary: legendaryPool } = splitEncounters(regionData);
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
    });
  } catch (err) {
    log.error({ err }, "Wild search error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// === 자동 야생 탐색(관심 포켓몬 + 30분 보관) ===

// 자동 탐색 현황 — 관심종은 지역별로 분리되므로 현재 지역 기준으로 내려준다(관심종·토글·보관함 +
// 현재 지역 출몰 종 목록과 지역키). 다른 지역 관심종은 그 지역으로 옮긴 뒤 조회한다.
gameRoutes.get("/interests", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const region = user.currentRegion ?? "default";
    res.json({
      interestSpecies: user.interestSpecies?.[region] ?? [],
      autoSearchEnabled: !!user.autoSearchEnabled,
      autoSearchShinyAny: !!user.autoSearchShinyAny,
      storedEncounters: user.storedEncounters ?? [],
      regionSpecies: regionSpeciesList(region),
      region,
    });
  } catch (err) {
    log.error({ err }, "Interests get error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 관심종 저장 — 현재 지역에만 저장한다(다른 지역 관심종은 보존). 현재 지역 출몰 풀에 있는 종만
// 허용(중복 제거). 하나라도 그 지역 미출몰이면 400.
gameRoutes.put("/interests", async (req: AuthRequest, res: Response) => {
  try {
    const { species } = req.body ?? {};
    if (!Array.isArray(species)) {
      res.status(400).json({ error: "관심 포켓몬 목록(species)이 필요합니다" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      const region = user.currentRegion ?? "default";
      for (const sp of species) {
        if (typeof sp !== "string" || !isWildSpecies(sp, region)) {
          res.status(400).json({ error: "해당 지역에 출몰하지 않는 종" });
          return;
        }
      }

      const interestSpecies = [...new Set(species as string[])];
      // 현재 지역 항목만 갱신하고 다른 지역 목록은 그대로 보존한다(normalize가 맵으로 정규화하지만,
      // 여기서도 기존 값을 방어적으로 객체 취급한다).
      user.interestSpecies = {
        ...(user.interestSpecies ?? {}),
        [region]: interestSpecies,
      };
      await saveUser(user);
      res.json({ interestSpecies, region });
    });
  } catch (err) {
    log.error({ err }, "Interests update error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 자동 탐색 토글 — 관심종 요건 없이 단순 on/off(끌 때는 물론, 켤 때도 관심종 유무를 검사하지 않는다).
gameRoutes.put("/auto-search", async (req: AuthRequest, res: Response) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled(boolean)가 필요합니다" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      user.autoSearchEnabled = enabled;
      await saveUser(user);
      res.json({ autoSearchEnabled: enabled });
    });
  } catch (err) {
    log.error({ err }, "Auto-search toggle error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 이로치 상시 보관 토글 — 관심종/보관함 상한과 무관하게 이로치를 보관할지 여부. autoSearchEnabled와
// 별개의 하위 옵션(단순 on/off). 실제 동작은 auto-search-worker가 autoSearchEnabled까지 함께 볼 때만.
gameRoutes.put("/auto-search-shiny", async (req: AuthRequest, res: Response) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled(boolean)가 필요합니다" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      user.autoSearchShinyAny = enabled;
      await saveUser(user);
      res.json({ autoSearchShinyAny: enabled });
    });
  } catch (err) {
    log.error({ err }, "Auto-search shiny toggle error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 보관함 인카운터로 전투 시작 — 보관함에서 그 이벤트를 꺼내 pendingEvents로 옮긴 뒤(전투 종료
// 정리 로직이 pendingEvents 기준이라 안전) 야생 전투를 연다. startWildBattle이 saveUser하므로
// 이동도 함께 영속된다.
gameRoutes.post("/stored/:id/battle", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid } = req.body ?? {};
    if (typeof pokemonUid !== "string") {
      res.status(400).json({ error: "포켓몬 UID를 입력해주세요" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      if (user.battleState) {
        res.status(400).json({ error: "이미 진행 중인 전투가 있습니다" });
        return;
      }

      const stored = user.storedEncounters ?? [];
      const event = stored.find((e) => e.id === req.params.id);
      if (!event) {
        res.status(404).json({ error: "보관된 인카운터를 찾을 수 없습니다" });
        return;
      }

      const pokemon = user.pokemon.find((p) => p.uid === pokemonUid);
      if (!pokemon) {
        res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
        return;
      }
      if (pokemon.hp <= 0) {
        res.status(400).json({ error: "기절한 포켓몬은 전투에 참여할 수 없습니다" });
        return;
      }

      // 보관함에서 제거하고 pendingEvents로 이동(같은 user 객체 — startWildBattle의 saveUser가 함께 영속).
      user.storedEncounters = stored.filter((e) => e.id !== event.id);
      user.pendingEvents.push(event);

      const { battleState, log: startLog } = await startWildBattle(user, event, pokemonUid);
      res.json({ battleState, log: startLog });
    });
  } catch (err) {
    log.error({ err }, "Stored encounter battle error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 주간보스 정보 — 이번 주 보스 정의(표시용) + 이번 주 처치 여부(bossDefeat 가드) + 순위 랭킹.
// 포털 /pokelog/boss 화면이 이 응답으로 보스 카드(아트·기술·특성·지닌물건·순위 보상)를 그린다.
// 특성/지닌물건은 이름뿐 아니라 실제 효과 설명(abilityDescription/heldItemDescription)도 내려줘
// 포켓몬을 잘 모르는 유저도 기믹을 이해하고 대응 준비를 할 수 있게 한다.
gameRoutes.get("/boss", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const now = new Date();
    const week = getIsoWeek(now);
    const boss = getCurrentBoss(now);
    const defeatedThisWeek =
      user.bossDefeat?.week === week && user.bossDefeat?.bossId === boss.id;

    const party = getPartyPokemon(user);
    const partyMaxLevel = party.reduce((max, p) => Math.max(max, p.level ?? 0), 0);
    const effectiveLevel = computeBossLevel(boss, partyMaxLevel);

    const clears = await getClears(week, boss.id);

    const abilityData = boss.ability ? getAbilityById(boss.ability) : undefined;

    res.json({
      boss: {
        id: boss.id,
        name: boss.name,
        species: boss.species,
        variantId: boss.variantId ?? null,
        level: effectiveLevel,
        moves: boss.moves,
        ability: boss.ability ?? null,
        abilityName: abilityData?.name ?? null,
        abilityDescription: abilityData?.shortEffect ?? null,
        heldItem: boss.heldItem ?? null,
        heldItemDescription: (boss.heldItem && HELD_ITEM_EFFECT_KO[boss.heldItem]) ?? null,
      },
      defeatedThisWeek,
      // 이번 주 처치로 배분받은 포획 시도권(없으면 null). 포털이 이 값으로 포획 UI를 띄운다.
      weeklyBossCapture: user.weeklyBossCapture ?? null,
      weekLabel: getIsoWeekLabel(now),
      rankPoints: RANK_POINTS,
      participationPoints: PARTICIPATION_POINTS,
      clears: clears.map((c) => ({ nickname: c.nickname, rank: c.rank, points: c.points })),
      bannedLegendary: true,
    });
  } catch (err) {
    log.error({ err }, "Boss info error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 주간보스 전투 시작 — 야생 전투 진입과 동일한 battleState 메커니즘을 쓴다. 이미 진행 중인 전투가
// 있으면 거부(야생 전투를 덮어쓰지 않도록), 파티에서 살아있는 리드를 자동 선택해 boss를 wild로
// 세팅하고 isBoss/bossId를 찍어 저장한다. 응답의 battleState로 포털 전투 화면이 바로 이어진다.
gameRoutes.post("/boss/start", async (req: AuthRequest, res: Response) => {
  try {
    await withLock(`user:${req.userId!}`, async () => {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (user.battleState) {
      res.status(400).json({ error: "이미 진행 중인 전투가 있습니다" });
      return;
    }

    const party = getPartyPokemon(user);
    const lead = party.find((p) => p.hp > 0);
    if (!lead) {
      res.status(400).json({ error: "전투에 내보낼 수 있는 포켓몬이 없습니다" });
      return;
    }

    // 전설/환상 포켓몬 참전 금지 — 기믹(타입 커버리지·지닌물건·상태이상 치료 등 "준비")을 써서
    // 평범한 포켓몬으로 깨게 만드는 것이 보스전의 의도이므로, 압도적인 전설/환상은 벤치에서도 막는다.
    const banned = party
      .map((p) => ({ p, species: getSpeciesByName(p.species) }))
      .filter(({ species }) => species?.isLegendary || species?.isMythical);
    if (banned.length > 0) {
      const names = banned.map(({ p }) => getDisplaySpeciesName(p.species)).join(", ");
      res.status(400).json({
        error: `전설/환상의 포켓몬(${names})은 주간보스전에 출전할 수 없습니다. 파티에서 빼주세요.`,
      });
      return;
    }

    const now = new Date();
    const boss = getCurrentBoss(now);
    const partyMaxLevel = party.reduce((max, p) => Math.max(max, p.level ?? 0), 0);
    const wild = buildBossWild(boss, computeBossLevel(boss, partyMaxLevel));

    const battleState: BattleState = {
      // 야생 조우처럼 pendingEvent를 참조하지 않는 합성 eventId(finishWin/handleRun의 pendingEvents
      // 필터는 no-op). 보스별·주별로 유일하게 만든다.
      eventId: `boss-${boss.id}-${getIsoWeek(now)}-${crypto.randomUUID()}`,
      myPokemonUid: lead.uid,
      participantUids: [lead.uid],
      turn: 0,
      wild,
      isBoss: true,
      bossId: boss.id,
      playerStatStages: defaultStatStages(),
      wildStatStages: defaultStatStages(),
      playerVolatile: [],
      wildVolatile: [],
    };

    // 리드의 원시회귀(그란돈/가이오가 등) — 야생전 /battle/start와 동일하게 처리.
    const primalForm = checkPrimalReversion(lead);
    if (primalForm) {
      battleState.playerBattleForm = primalForm;
      battleState.transformationType = "primal";
      const transformed = getTransformedStats(lead, primalForm);
      lead.stats = transformed.stats;
      lead.maxHp = transformed.maxHp;
      lead.hp = Math.min(lead.hp, lead.maxHp);
    }

    const startLog: string[] = [`주간보스 ${boss.name}이(가) 나타났다!`];
    // 스위치인 특성(위협·날씨/필드 세터 등): 야생전 시작과 동일하게 양측 등장 효과를 적용한다.
    // 보스의 drizzle/drought/sand-stream/snow-warning 등이 여기서 날씨를 세팅한다.
    battleState.wildStatStages = applySwitchInAbilities(
      battleState, "player", lead, battleState.wildStatStages!, startLog,
    );
    applyImposterOnSwitchIn(battleState, lead, startLog); // 변신둔갑
    battleState.playerStatStages = applySwitchInAbilities(
      battleState, "wild", wild, battleState.playerStatStages!, startLog,
    );

    // 보스 종도 영구 "만난적(seen)"에 기록한다.
    const seenList = user.seenSpecies ?? (user.seenSpecies = []);
    if (!seenList.includes(wild.species)) seenList.push(wild.species);

    user.battleState = battleState;
    await saveUser(user);
    void appendEvent({
      type: "battle_start",
      userId: user.account.id,
      detail: {
        boss: boss.id,
        wildSpecies: wild.species,
        wildLevel: wild.level,
        myPokemonUid: lead.uid,
      },
    });
    res.json({ battleState, log: startLog });
    });
  } catch (err) {
    log.error({ err }, "Boss start error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// ========== 월드보스(전 유저 공유체력 공동전) ==========

/** 월드보스 상태 → 플레이어 뷰(요청 유저 관점). 만료 지연 검사 후의 상태를 쓴다. */
// 아레나(공유 화면)에서 "지금 실시간 전투 중"으로 볼 시간창(ms). lastActiveAt(참전 + 매 공격 시 갱신)이
// 이 창 안이면 activeInBattle=true. 턴제라 공격 간 간격이 있어 너무 짧으면 깜빡이므로 넉넉히 45s.
const ARENA_ACTIVE_WINDOW_MS = 45_000;

function worldBossView(state: WorldBossState | null, userId: string, cooldownMs: number): Record<string, unknown> {
  // 활성도 아니고 처치도 아니면(스폰 전/만료 종료) 빈 뷰. 처치 직후에는 active=false여도 아레나/포획
  // 유도를 위해 defeated 상태를 노출한다.
  if (!state || (!state.active && !state.defeated)) {
    return { active: false, boss: null, defeated: false, participants: [], attackFeed: [], chat: [], myDamage: 0, myCooldownMs: 0, myCapture: null };
  }
  const s = state;
  const now = Date.now();
  const participants = Object.entries(s.contributions)
    .map(([uid, c]) => ({
      userId: uid,
      nickname: c.nickname,
      species: c.pokemon.species,
      variantId: c.pokemon.variantId,
      shiny: c.pokemon.shiny,
      damage: c.damage,
      // 지금 실시간 전투 중인지 — 아레나(공유 화면)는 이 플래그가 true인 참전자만 스프라이트로 띄운다.
      activeInBattle: c.lastActiveAt
        ? now - new Date(c.lastActiveAt).getTime() < ARENA_ACTIVE_WINDOW_MS
        : false,
    }))
    .sort((a, b) => b.damage - a.damage);

  const myContribution = s.contributions[userId];
  const lastAttackAt = myContribution?.lastActiveAt;
  const myCooldownMs = lastAttackAt
    ? Math.max(0, cooldownMs - (Date.now() - new Date(lastAttackAt).getTime()))
    : 0;

  return {
    active: s.active,
    boss: { species: s.species, variantId: s.variantId, level: s.level, name: s.name, shiny: s.wild.isShiny ?? false },
    globalHp: s.globalHp,
    globalMaxHp: s.globalMaxHp,
    defeated: s.defeated,
    expiresAt: s.expiresAt,
    participants,
    attackFeed: s.attackFeed,
    chat: s.chat,
    myDamage: myContribution?.damage ?? 0,
    myCooldownMs,
    myCapture: null as unknown, // 아래에서 유저별로 덮어씀
  };
}

// 월드보스 라이브 뷰 — 만료 지연 검사 후 아레나/공유HP/참전자/피드/채팅 + 내 데미지·쿨다운·포획권.
gameRoutes.get("/world-boss", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    const config = await getConfig();
    const state = await endWorldBossIfExpired();
    const view = worldBossView(state, user.account.id, config.worldBoss.cooldownMs);
    // 내 쿨다운은 lastWorldBossAttackAt(참전 시각) 기준으로도 반영 — contributions.lastActiveAt은
    // 딜마다 갱신되므로 "참전 쿨다운"과는 다르다. 더 보수적인(긴) 쪽을 남긴다.
    if (user.lastWorldBossAttackAt) {
      const enterCooldown = Math.max(0, config.worldBoss.cooldownMs - (Date.now() - new Date(user.lastWorldBossAttackAt).getTime()));
      view.myCooldownMs = Math.max((view.myCooldownMs as number) ?? 0, enterCooldown);
    }
    view.myCapture = user.worldBossCapture ?? null;
    res.json(view);
  } catch (err) {
    log.error({ err }, "World-boss view error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 월드보스 참전 — 쿨다운/활성보스/살아있는 포켓몬 검사 후, 현재 globalHp를 hp로 스냅한 보스전을
// 연다(startWildBattle이 아니라 boss/start와 동일한 인라인 세팅 — isWorldBoss/worldBossId 표식).
gameRoutes.post("/world-boss/enter", async (req: AuthRequest, res: Response) => {
  try {
    // user 락은 유저 데이터(배틀상태/쿨다운)의 읽기-수정-저장까지만 잡는다. world-boss 락(mutateWorldBoss)은
    // 그 뒤 락을 놓고 잡는다 — 데미지 반영 경로가 'world-boss'→'user:u' 순서로 락을 잡으므로, 여기서
    // 'user'를 쥔 채 'world-boss'를 잡으면 교차 교착이 생긴다. 순서를 world-boss→user로 통일해 이를 막는다.
    const prepared = await withLock(`user:${req.userId!}`, async (): Promise<
      | { battleState: BattleState; startLog: string[]; pokemon: OwnedPokemon; nickname: string; userId: string; bossId: string; wildSpecies: string; wildLevel: number; pokemonUid: string }
      | null
    > => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return null;
      }

      const pokemonUid = typeof req.body?.pokemonUid === "string" ? req.body.pokemonUid : "";
      if (!pokemonUid) {
        res.status(400).json({ error: "포켓몬 UID를 입력해주세요" });
        return null;
      }

      if (user.battleState) {
        res.status(400).json({ error: "이미 진행 중인 전투가 있습니다" });
        return null;
      }

      const config = await getConfig();
      const state = await endWorldBossIfExpired();
      if (!state || !state.active || state.defeated || state.globalHp <= 0) {
        res.status(400).json({ error: "현재 진행 중인 월드보스가 없습니다" });
        return null;
      }

      // 참전당 쿨다운 — 마지막 참전 이후 cooldownMs가 지나야 한다.
      if (user.lastWorldBossAttackAt) {
        const elapsed = Date.now() - new Date(user.lastWorldBossAttackAt).getTime();
        if (elapsed < config.worldBoss.cooldownMs) {
          const remainMs = config.worldBoss.cooldownMs - elapsed;
          res.status(400).json({ error: "아직 재참전 쿨다운입니다", cooldownMs: remainMs });
          return null;
        }
      }

      const pokemon = user.pokemon.find((p) => p.uid === pokemonUid);
      if (!pokemon) {
        res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
        return null;
      }
      if (pokemon.hp <= 0) {
        res.status(400).json({ error: "기절한 포켓몬은 전투에 참여할 수 없습니다" });
        return null;
      }
      if (!user.party.includes(pokemonUid)) {
        res.status(400).json({ error: "파티의 포켓몬만 참전할 수 있습니다" });
        return null;
      }

      // 현재 공유 체력을 hp로 스냅해 보스 개체를 복제한다(전투 중 표시·데미지 계산 기준).
      const wild = { ...state.wild, hp: Math.min(state.globalHp, state.wild.maxHp) };

      const battleState: BattleState = {
        eventId: `world-boss-${state.bossId}-${crypto.randomUUID()}`,
        myPokemonUid: pokemonUid,
        participantUids: [pokemonUid],
        turn: 0,
        wild,
        isWorldBoss: true,
        worldBossId: state.bossId,
        playerStatStages: defaultStatStages(),
        wildStatStages: defaultStatStages(),
        playerVolatile: [],
        wildVolatile: [],
      };

      // 리드의 원시회귀(그란돈/가이오가 등) — 야생전/보스전과 동일 처리.
      const primalForm = checkPrimalReversion(pokemon);
      if (primalForm) {
        battleState.playerBattleForm = primalForm;
        battleState.transformationType = "primal";
        const transformed = getTransformedStats(pokemon, primalForm);
        pokemon.stats = transformed.stats;
        pokemon.maxHp = transformed.maxHp;
        pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
      }

      const startLog: string[] = [`월드보스 ${state.name}에게 도전한다!`];
      battleState.wildStatStages = applySwitchInAbilities(battleState, "player", pokemon, battleState.wildStatStages!, startLog);
      applyImposterOnSwitchIn(battleState, pokemon, startLog); // 변신둔갑
      battleState.playerStatStages = applySwitchInAbilities(battleState, "wild", wild, battleState.playerStatStages!, startLog);

      const seenList = user.seenSpecies ?? (user.seenSpecies = []);
      if (!seenList.includes(wild.species)) seenList.push(wild.species);

      // 참전 시각 기록(쿨다운 기준).
      user.lastWorldBossAttackAt = new Date().toISOString();
      user.battleState = battleState;
      await saveUser(user);

      return {
        battleState, startLog, pokemon,
        nickname: user.account.nickname, userId: user.account.id,
        bossId: state.bossId, wildSpecies: wild.species, wildLevel: wild.level, pokemonUid,
      };
    });

    // 유저 락을 놓은 뒤 world-boss 락으로 참전자 등록(아레나 표시용). 락 순서 world-boss→user를
    // 지키기 위해 유저 락 밖에서 수행한다(교차 교착 방지). 응답도 여기서 확정.
    if (!prepared) return; // 위에서 이미 검증 실패 응답을 보냈다.

    await mutateWorldBoss((ws) => {
      if (ws.bossId !== prepared.bossId) return null;
      const existing = ws.contributions[prepared.userId];
      ws.contributions[prepared.userId] = {
        nickname: prepared.nickname,
        damage: existing?.damage ?? 0,
        pokemon: { species: prepared.pokemon.species, variantId: prepared.pokemon.variantId ?? null, shiny: prepared.pokemon.isShiny ?? false },
        lastActiveAt: new Date().toISOString(),
      };
      return ws;
    });

    void appendEvent({
      type: "battle_start",
      userId: prepared.userId,
      detail: { worldBoss: prepared.bossId, wildSpecies: prepared.wildSpecies, wildLevel: prepared.wildLevel, myPokemonUid: prepared.pokemonUid },
    });
    res.json({ battleState: prepared.battleState, log: prepared.startLog });
  } catch (err) {
    log.error({ err }, "World-boss enter error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

const WORLD_BOSS_CHAT_MAX_LENGTH = 500;

// 월드보스 참여 채팅 — 활성 보스가 있을 때만, 길이 검증 후 링버퍼(CHAT_MAX)에 추가한다.
gameRoutes.post("/world-boss/chat", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "빈 메시지는 보낼 수 없습니다" });
      return;
    }
    if (text.length > WORLD_BOSS_CHAT_MAX_LENGTH) {
      res.status(400).json({ error: `메시지는 ${WORLD_BOSS_CHAT_MAX_LENGTH}자 이하여야 합니다` });
      return;
    }

    const current = await getWorldBoss();
    if (!current || !current.active) {
      res.status(400).json({ error: "현재 진행 중인 월드보스가 없습니다" });
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      userId: user.account.id,
      nickname: user.account.nickname,
      text,
      at: new Date().toISOString(),
    };
    await mutateWorldBoss((ws) => {
      ws.chat.push(message);
      if (ws.chat.length > CHAT_MAX) ws.chat = ws.chat.slice(-CHAT_MAX);
      return ws;
    });
    res.json({ message });
  } catch (err) {
    log.error({ err }, "World-boss chat error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 월드보스 포획 — 처치 후 배분받은 시도권(worldBossCapture)으로 볼을 던진다. 확률 판정(capture.ts)
// + 볼 catchBonus. 성공: 개체 지급(파티/보관함·도감) + capture 소멸. 실패: ballAttempts 1 차감.
gameRoutes.post("/world-boss/capture", async (req: AuthRequest, res: Response) => {
  try {
    await withLock(`user:${req.userId!}`, async () => {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const capture = user.worldBossCapture;
    if (!capture || capture.ballAttempts <= 0) {
      res.status(400).json({ error: "사용할 수 있는 포획 시도권이 없습니다" });
      return;
    }

    const config = await getConfig();
    // 볼은 capture.ballItem(스폰 시 config.worldBoss.captureBall)로 고정 — 별도 인벤토리 소모는 없다
    // (시도권 자체가 볼). 볼 메타는 guaranteedCatch(마스터볼류) 판정에만 쓴다.
    const ballItem = resolveShopItem(config, capture.ballItem);
    const guaranteedCatch = ballItem?.guaranteedCatch ?? false;

    // 볼당 포획 확률은 config.worldBoss.captureBaseRate(0~1) 그대로 쓰는 "플랫" 확률이다.
    // (HP 감쇠·볼 catchBonus 배율 없음 → GO식 볼 소모형. 운영자가 /admin에서 확률을 낮출 수 있다.)
    const caught = guaranteedCatch || Math.random() < config.worldBoss.captureBaseRate;

    const remainingAttempts = capture.ballAttempts - 1;

    if (caught) {
      // 배분 시점 정보로 개체를 만든다(레벨·종·변종·이로치). createWildPokemon으로 종/변종·레벨에 맞는
      // 개체를 만든 뒤(랜덤 성격/IV) 이로치만 배분값으로 고정하고, wildPokemonToOwned로 소유 개체화한다.
      const wild = createWildPokemon(capture.variantId ?? capture.species, capture.level);
      wild.isShiny = capture.shiny;
      const newPokemon = wildPokemonToOwned(wild);
      newPokemon.isShiny = capture.shiny;

      if (user.party.length < 6) {
        user.pokemon.push(newPokemon);
        user.party.push(newPokemon.uid);
      } else {
        user.storage.push(newPokemon);
      }
      if (!user.pokedex.includes(newPokemon.species)) user.pokedex.push(newPokemon.species);

      // 포획 성공 → 시도권 소멸.
      user.worldBossCapture = undefined;
      await saveUser(user);
      res.json({ caught: true, pokemon: newPokemon, ballAttempts: 0, message: `${getDisplaySpeciesName(newPokemon.species)}을(를) 잡았다!` });
      return;
    }

    // 실패 → 시도권 1 차감(0이면 소멸).
    if (remainingAttempts <= 0) {
      user.worldBossCapture = undefined;
    } else {
      user.worldBossCapture = { ...capture, ballAttempts: remainingAttempts };
    }
    await saveUser(user);
    res.json({ caught: false, ballAttempts: remainingAttempts, message: "아깝다! 잡지 못했다..." });
    });
  } catch (err) {
    log.error({ err }, "World-boss capture error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 주간보스 포획 — 이번 주 처치 후 배분받은 시도권(weeklyBossCapture)으로 볼을 던진다. 월드보스 포획과
// 동형이지만 시도권 출처(주간보스 처치 랭킹)와 기본 확률(config.weeklyBoss.captureBaseRate)만 다르다.
// 성공: 개체 지급(파티/보관함·도감) + capture 소멸. 실패: ballAttempts 1 차감(0이면 소멸).
gameRoutes.post("/weekly-boss/capture", async (req: AuthRequest, res: Response) => {
  try {
    await withLock(`user:${req.userId!}`, async () => {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const capture = user.weeklyBossCapture;
    if (!capture || capture.ballAttempts <= 0) {
      res.status(400).json({ error: "사용할 수 있는 포획 시도권이 없습니다" });
      return;
    }

    const config = await getConfig();
    // 볼은 capture.ballItem(처치 시 config.weeklyBoss.captureBall)로 고정 — 별도 인벤토리 소모는 없다
    // (시도권 자체가 볼). 볼 메타는 guaranteedCatch(마스터볼류) 판정에만 쓴다.
    const ballItem = resolveShopItem(config, capture.ballItem);
    const guaranteedCatch = ballItem?.guaranteedCatch ?? false;

    // 볼당 포획 확률은 config.weeklyBoss.captureBaseRate(0~1) 그대로 쓰는 "플랫" 확률이다.
    // (HP 감쇠·볼 catchBonus 배율 없음 → GO식 볼 소모형. 운영자가 /admin에서 확률을 낮출 수 있다.)
    const caught = guaranteedCatch || Math.random() < config.weeklyBoss.captureBaseRate;

    const remainingAttempts = capture.ballAttempts - 1;

    if (caught) {
      // 배분 시점 정보로 개체를 만든다(레벨·종·변종·이로치). createWildPokemon으로 종/변종·레벨에 맞는
      // 개체를 만든 뒤(랜덤 성격/IV) 이로치만 배분값으로 고정하고, wildPokemonToOwned로 소유 개체화한다.
      const wild = createWildPokemon(capture.variantId ?? capture.species, capture.level);
      wild.isShiny = capture.shiny;
      const newPokemon = wildPokemonToOwned(wild);
      newPokemon.isShiny = capture.shiny;

      if (user.party.length < 6) {
        user.pokemon.push(newPokemon);
        user.party.push(newPokemon.uid);
      } else {
        user.storage.push(newPokemon);
      }
      if (!user.pokedex.includes(newPokemon.species)) user.pokedex.push(newPokemon.species);

      // 포획 성공 → 시도권 소멸.
      user.weeklyBossCapture = undefined;
      await saveUser(user);
      res.json({ caught: true, pokemon: newPokemon, ballAttempts: 0, message: `${getDisplaySpeciesName(newPokemon.species)}을(를) 잡았다!` });
      return;
    }

    // 실패 → 시도권 1 차감(0이면 소멸).
    if (remainingAttempts <= 0) {
      user.weeklyBossCapture = undefined;
    } else {
      user.weeklyBossCapture = { ...capture, ballAttempts: remainingAttempts };
    }
    await saveUser(user);
    res.json({ caught: false, ballAttempts: remainingAttempts, message: "아깝다! 잡지 못했다..." });
    });
  } catch (err) {
    log.error({ err }, "Weekly-boss capture error");
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

    await withLock(`user:${req.userId!}`, async () => {
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
    });
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
    const region = user.currentRegion ?? "default";
    // 파티에서 연 상세 모달에서도 진화 버튼이 뜨도록, /party·/storage와 동일하게 계산 전용
    // 진화 필드를 부착한다(스프레드 복제본만 — 저장 객체 변형 금지). 진화 후 재조회 시에도
    // 진화한 폼의 최신 선택지가 실려 체인 진화가 파티 모달에서 이어진다.
    const evolutionOptions = getAvailableEvolutionOptions(user, pokemon, { region });
    // getEvolutionBranchDiagnostics already resolves a variant-aware targetName
    // (the form's name when a branch evolves into a variant), so use it directly.
    const evolutionPreview = getEvolutionBranchDiagnostics(pokemon.species, {
      level: pokemon.level,
      ...buildLevelEvolutionContext(pokemon, activeParty, { region }),
    });

    res.json({
      pokemon: { ...pokemon, evolutionAvailable: evolutionOptions.length > 0, evolutionOptions },
      evolutionPreview,
    });
  } catch (err) {
    log.error({ err }, "Pokemon detail error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 기술 일괄 편집 — 배울 수 있는 전체 기술 풀 조회. 종의 레벨업 학습표 전 레벨 ∪ TM ∪ 교배 ∪
// 가르침을 합친 풀(현재 아는 기술도 포함)과 새 기술 1개당 비용(changeCost), 보유 게임머니를 내려준다.
gameRoutes.get("/pokemon/:uid/learnable-moves", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }
    const pokemon = findPokemonByUid(user, req.params.uid);
    if (!pokemon) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }
    const config = await getConfig();
    res.json({
      learnable: getAllLearnableMoves(pokemon),
      gameMoney: user.gameMoney,
      changeCost: config.moveChangeCost,
    });
  } catch (err) {
    log.error({ err }, "Learnable moves list error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 기술 일괄 편집 — 4개 슬롯 일괄 저장. moveIds(1~4개)로 pokemon.moves를 통째로 교체하고, 원래
// 없던(새로 배우는) 기술 수만큼만 게임머니를 차감한다(자리 이동·삭제·유지는 무료). 검증 위반은
// setPokemonMoves가 GameRuleError(400)로 던지고, 아래 핸들러가 관례대로 400으로 응답한다.
gameRoutes.post("/pokemon/:uid/set-moves", async (req: AuthRequest, res: Response) => {
  try {
    const { moveIds } = req.body ?? {};
    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }
      const pokemon = findPokemonByUid(user, req.params.uid);
      if (!pokemon) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }

      const config = await getConfig();
      const { cost } = setPokemonMoves(user, pokemon, moveIds, config.moveChangeCost);
      await saveUser(user);

      res.json({
        pokemon: { ...pokemon },
        gameMoney: user.gameMoney,
        cost,
      });
    });
  } catch (err) {
    if (err instanceof GameRuleError) { res.status(err.status).json({ error: err.message }); return; }
    log.error({ err }, "Set moves error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 개체 튜닝 정보 — 이 종이 가질 수 있는 특성 목록(normal ∪ hidden), 카테고리별 변경 비용(costs),
// 보유 게임머니를 내려준다. 포털 상세 모달의 IV/성격/특성 에디터가 특성 드롭다운·비용 표시에 쓴다.
// (성격 25종은 클라이언트가 고정 목록으로 알고 있어 여기선 특성만 종 의존적으로 계산해 준다.)
gameRoutes.get("/pokemon/:uid/tunable", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }
    const pokemon = findPokemonByUid(user, req.params.uid);
    if (!pokemon) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }

    const config = await getConfig();
    const speciesAbilities = getSpeciesByName(pokemon.species)?.abilities;
    const abilities = speciesAbilities
      ? [...speciesAbilities.normal, ...(speciesAbilities.hidden ? [speciesAbilities.hidden] : [])]
      : [];
    res.json({ abilities, costs: config.tuning, gameMoney: user.gameMoney });
  } catch (err) {
    log.error({ err }, "Tunable info error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 개체 튜닝 — IV/성격/특성을 게임머니로 자유 변경(아이템 불필요). body에 담긴(존재하는) 카테고리만
// 적용하고 그 비용의 합만큼 차감한다. IV(0~31 정수)·성격(25종)·특성(종 보유 특성) 검증과 게임머니
// 부족은 tunePokemon이 GameRuleError(400)로 던지며, 부분 적용 없이 원자적으로 처리한다. IV·성격
// 변경 시 스탯이 재계산되고 hp가 새 maxHp로 클램프된다.
gameRoutes.patch("/pokemon/:uid/tune", async (req: AuthRequest, res: Response) => {
  try {
    const { ivs, nature, abilityId } = req.body ?? {};
    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }
      const pokemon = findPokemonByUid(user, req.params.uid);
      if (!pokemon) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }

      const config = await getConfig();
      const { cost } = tunePokemon(user, pokemon, { ivs, nature, abilityId }, config.tuning);
      await saveUser(user);

      res.json({ pokemon: { ...pokemon }, gameMoney: user.gameMoney, cost });
    });
  } catch (err) {
    if (err instanceof GameRuleError) { res.status(err.status).json({ error: err.message }); return; }
    log.error({ err }, "Tune pokemon error");
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
      shinyCaught: user.shinyPokedex ?? [],
      allSpecies: getAllSpecies(),
    });
  } catch (err) {
    log.error({ err }, "Pokedex error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 업적 목록 + 지연 평가 보상 지급. 현재 유저 상태와 PvP 승수로 미완료 업적을 검사해, 충족분에
// 보상을 1회 지급(completedAchievements 가드)하고 갱신된 재화와 함께 전체 진행 상태를 내려준다.
// 신규 달성이 있을 때만 saveUser로 영속한다(멱등: 재호출해도 이미 완료분은 재지급되지 않음).
gameRoutes.get("/achievements", async (req: AuthRequest, res: Response) => {
  try {
    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      // PvP 승수·트레이드 성사 수는 유저 파일이 아니라 각각 pvp-stats/trade 저장소에 있다.
      const stats = await getStats(user.account.id);
      const pvpWins = stats?.wins ?? 0;
      const tradesCompleted = await getCompletedTradeCount(user.account.id);

      const result = evaluateAchievements(user, pvpWins, tradesCompleted);
      if (result.newlyCompleted.length > 0) {
        await saveUser(user);
      }

      res.json({
        achievements: result.list,
        newlyCompleted: result.newlyCompleted,
        rewards: result.rewardsGranted,
        points: user.points,
        gameMoney: user.gameMoney,
      });
    });
  } catch (err) {
    log.error({ err }, "Achievements error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 칭호 목록 + 장착 상태(읽기 전용). 현재 유저 상태·PvP 승수·트레이드 수로 각 칭호의 획득(earned)/
// 장착(active) 여부를 지연 파생해 내려준다. 보상 지급이 없으므로 락 불필요(saveUser 없음).
gameRoutes.get("/titles", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    // PvP 승수·트레이드 성사 수는 유저 파일이 아니라 각각 pvp-stats/trade 저장소에 있다.
    const stats = await getStats(user.account.id);
    const pvpWins = stats?.wins ?? 0;
    const tradesCompleted = await getCompletedTradeCount(user.account.id);

    const titles = evaluateTitles(user, pvpWins, tradesCompleted, user.activeTitle ?? null);
    res.json({ titles, activeTitle: user.activeTitle ?? null });
  } catch (err) {
    log.error({ err }, "Titles error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 칭호 장착/해제. body.titleId(문자열=장착, null=해제). 장착 시 해당 칭호가 실제로 획득(earned)
// 되었는지 서버가 met으로 재검증한다(획득하지 않은 칭호는 거부). 유저 상태를 변형하므로 락으로 감싼다.
gameRoutes.put("/titles/active", async (req: AuthRequest, res: Response) => {
  try {
    const titleId = req.body?.titleId;
    if (titleId !== null && typeof titleId !== "string") {
      res.status(400).json({ error: "titleId(문자열 또는 null)가 필요합니다" });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      if (titleId === null) {
        user.activeTitle = null;
      } else {
        const def = TITLES.find((t) => t.id === titleId);
        if (!def) {
          res.status(400).json({ error: "존재하지 않는 칭호입니다" });
          return;
        }
        // 장착 자격 검증 — PvP 승수·트레이드 수는 pvp-stats/trade 저장소에서 조회해 주입한다.
        const stats = await getStats(user.account.id);
        const pvpWins = stats?.wins ?? 0;
        const tradesCompleted = await getCompletedTradeCount(user.account.id);
        if (!def.met(user, pvpWins, tradesCompleted)) {
          res.status(400).json({ error: "획득하지 않은 칭호입니다" });
          return;
        }
        user.activeTitle = titleId;
      }

      await saveUser(user);
      res.json({ activeTitle: user.activeTitle ?? null });
    });
  } catch (err) {
    log.error({ err }, "Set active title error");
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

    await withLock(`user:${req.userId!}`, async () => {
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
    await withLock(`user:${req.userId!}`, async () => {
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
    });
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
