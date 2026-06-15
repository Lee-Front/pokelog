import { Router } from "express";
import crypto from "node:crypto";
import { getConfig, saveConfig } from "../storage/config-store.js";
import { getUser, saveUser, getAllUsers } from "../storage/user-store.js";
import { pollAllRepos, recomputeUserSerialized } from "../polling/polling-worker.js";
import { calculateReward } from "../game/reward.js";
import { judgeCombo, getComboMultiplier } from "../game/combo.js";
import { selectWildPokemon, scaleWildLevel } from "../game/encounter.js";
import { createWildPokemon, createPokemon } from "../game/pokemon-factory.js";
import { getRegion } from "../game/data-loader.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { incrementItem } from "../game/inventory-utils.js";
import {
  applyLearnedMoves,
  buildLevelEvolutionContext,
  checkLevelUp,
  evolvePokemon,
  getMatchingEvolutionBranches,
} from "../game/growth.js";
import { calculateStatsForLevel } from "../game/pokemon-stats.js";
import { getPartyPokemon } from "../game/pokemon-state.js";
import type { ServerConfig } from "../../../../shared/types.js";
import { INTEGRATION_EVENT_CATALOG } from "../integrations/event-catalog.js";
import { clearPendingEvolutionForPokemon, queuePendingEvolution } from "../game/pending-evolution.js";

import { query as queryEventLog } from "../storage/event-log.js";
import { adminMiddleware } from "../middleware/admin-middleware.js";
import { childLogger } from "../logger.js";

const log = childLogger("admin-routes");

export const adminRoutes = Router();
adminRoutes.use(adminMiddleware);

const startTime = Date.now();

// Add repo
adminRoutes.post("/repo", async (req, res) => {
  try {
    const { url, branches } = req.body;
    if (!url) return res.status(400).json({ error: "url이 필요합니다" });

    const config = await getConfig();
    const exists = config.polling.repos.some((r) => r.url === url);
    if (exists) return res.status(409).json({ error: "이미 등록된 repo입니다" });

    config.polling.repos.push({ url, branches: branches || ["main"] });
    await saveConfig(config);
    res.json({ ok: true, repos: config.polling.repos });
  } catch (err) {
    res.status(500).json({ error: "서버 오류" });
  }
});

// List repos
adminRoutes.get("/repos", async (_req, res) => {
  try {
    const config = await getConfig();
    res.json({ repos: config.polling.repos });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Remove repo
adminRoutes.delete("/repo", async (req, res) => {
  try {
    const { url } = req.body;
    const config = await getConfig();
    config.polling.repos = config.polling.repos.filter((r) => r.url !== url);
    await saveConfig(config);
    res.json({ ok: true, repos: config.polling.repos });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Get config
adminRoutes.get("/config", async (_req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

adminRoutes.get("/config/integration-events", async (_req, res) => {
  try {
    const config = await getConfig();
    res.json({
      catalog: INTEGRATION_EVENT_CATALOG,
      rules: config.rewards.integrations,
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

const ALLOWED_CONFIG_PATHS = new Set([
  "polling.intervalMinutes",
  "rewards.expPerByte",
  "rewards.pointsPerByte",
  "rewards.combo.bytesPerMinute",
  "rewards.combo.maxMultiplier",
  "rewards.combo.multipliers",
  "rewards.encounter.baseChance",
  "rewards.encounter.ceilingBytes",
  "rewards.encounter.timeLimitHours",
  "rewards.encounter.searchCost",
  "meta.serverName",
  "meta.displayName",
  "meta.apiVersion",
  "meta.featureFlags.pvp",
  "meta.featureFlags.trade",
  "meta.featureFlags.achievements",
  "meta.featureFlags.regions",
  // 알 가챠 — 티어별 cost/레벨 + 등급 버킷 등장확률(legendary/rare) + 전역 이로치율.
  "egg.common.cost",
  "egg.common.minLevel",
  "egg.common.maxLevel",
  "egg.common.legendaryChance",
  "egg.common.rareChance",
  "egg.rare.cost",
  "egg.rare.minLevel",
  "egg.rare.maxLevel",
  "egg.rare.legendaryChance",
  "egg.rare.rareChance",
  "egg.legend.cost",
  "egg.legend.minLevel",
  "egg.legend.maxLevel",
  "egg.legend.legendaryChance",
  "egg.legend.rareChance",
  "shinyRate",
  // PvP(Phase 2) — ELO 시작 레이팅/K 계수(모든 매치 적용).
  "pvp.elo.start",
  "pvp.elo.k",
]);

// PvP 설정 검증 — ELO start/k는 양수.
function validatePvp(key: string, value: unknown): string | null {
  const isNum = typeof value === "number" && Number.isFinite(value);
  if (key === "pvp.elo.start" || key === "pvp.elo.k") {
    return isNum && (value as number) > 0 ? null : "ELO 값은 0보다 커야 합니다";
  }
  return null;
}

// 알/이로치 설정 검증 — 키 끝부분(leaf)으로 규칙을 고른다. 범위: cost≥0,
// level 1~100(min≤max는 저장 후 부화 시 rollLevel이 음수 범위를 피하도록 별도 보장),
// legendaryChance/rareChance 0~1(합≤1은 저장 단계에서 형제값과 비교해 별도 보장),
// shinyRate 0~1.
function validateEggOrShiny(key: string, value: unknown): string | null {
  const isNum = typeof value === "number" && Number.isFinite(value);
  if (key === "shinyRate") {
    return isNum && value >= 0 && value <= 1 ? null : "이로치율은 0~1 사이 숫자여야 합니다";
  }
  const leaf = key.split(".").pop();
  if (leaf === "cost") {
    return isNum && (value as number) >= 0 ? null : "cost는 0 이상이어야 합니다";
  }
  if (leaf === "minLevel" || leaf === "maxLevel") {
    return isNum && Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100
      ? null
      : "레벨은 1~100 사이 정수여야 합니다";
  }
  if (leaf === "legendaryChance" || leaf === "rareChance") {
    return isNum && (value as number) >= 0 && (value as number) <= 1
      ? null
      : "등장확률은 0~1 사이 숫자여야 합니다";
  }
  return null;
}

// Set config value
adminRoutes.put("/config", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "key가 필요합니다" });

    if (!ALLOWED_CONFIG_PATHS.has(key)) {
      return res.status(400).json({ error: "허용되지 않는 설정 키입니다" });
    }

    // The combo curve is indexed into by getComboMultiplier, so a malformed
    // value would break reward calculation — require a non-empty array of
    // positive numbers.
    if (key === "rewards.combo.multipliers") {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every((m) => typeof m === "number" && Number.isFinite(m) && m > 0)
      ) {
        return res.status(400).json({ error: "multipliers는 양수로 이루어진 비어있지 않은 배열이어야 합니다" });
      }
    }

    if (key === "shinyRate" || key.startsWith("egg.")) {
      const eggError = validateEggOrShiny(key, value);
      if (eggError) return res.status(400).json({ error: eggError });
    }

    if (key.startsWith("pvp.")) {
      const pvpError = validatePvp(key, value);
      if (pvpError) return res.status(400).json({ error: pvpError });
    }

    const config = await getConfig();

    // 알 레벨은 min ≤ max를 보장해야 rollLevel이 음수 범위로 깨지지 않는다.
    // 한 쪽만 저장하므로 반대편은 현재 저장값과 비교한다.
    if (key === "egg.common.minLevel" || key === "egg.rare.minLevel" || key === "egg.legend.minLevel") {
      const tier = key.split(".")[1] as keyof typeof config.egg;
      if ((value as number) > config.egg[tier].maxLevel) {
        return res.status(400).json({ error: "최소 레벨은 최대 레벨보다 클 수 없습니다" });
      }
    }
    if (key === "egg.common.maxLevel" || key === "egg.rare.maxLevel" || key === "egg.legend.maxLevel") {
      const tier = key.split(".")[1] as keyof typeof config.egg;
      if ((value as number) < config.egg[tier].minLevel) {
        return res.status(400).json({ error: "최대 레벨은 최소 레벨보다 작을 수 없습니다" });
      }
    }

    // 버킷 등장확률은 legendaryChance + rareChance ≤ 1을 보장해야 common 파생확률이
    // 음수가 되지 않는다. 한 쪽만 저장하므로 반대편은 현재 저장값과 합산해 비교한다.
    const chanceLeaf = key.split(".").pop();
    if ((chanceLeaf === "legendaryChance" || chanceLeaf === "rareChance") && key.startsWith("egg.")) {
      const tier = key.split(".")[1] as keyof typeof config.egg;
      const sibling =
        chanceLeaf === "legendaryChance" ? config.egg[tier].rareChance : config.egg[tier].legendaryChance;
      if ((value as number) + sibling > 1) {
        return res.status(400).json({ error: "전설·희귀 등장확률의 합은 1을 넘을 수 없습니다" });
      }
    }

    const keys = key.split(".");
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>;
      if (!obj) return res.status(400).json({ error: `잘못된 경로: ${key}` });
    }
    obj[keys[keys.length - 1]] = value;
    await saveConfig(config);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// Server status
adminRoutes.get("/status", async (_req, res) => {
  try {
    const config = await getConfig();
    const users = await getAllUsers();
    res.json({
      uptime: Math.floor((Date.now() - startTime) / 1000),
      repoCount: config.polling.repos.length,
      userCount: users.length,
      pollingInterval: config.polling.intervalMinutes,
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// List users — summary for the admin recompute/debug tool. Includes the
// commit-derived balances and integration count so an operator can spot users
// whose balance looks wrong (e.g. zeroed by #19) before recomputing them.
adminRoutes.get("/users", async (_req, res) => {
  try {
    const users = await getAllUsers();
    res.json(
      users.map((u) => ({
        id: u.account.id,
        nickname: u.account.nickname,
        points: u.points,
        totalExp: u.totalExp,
        integrationCount: u.integrations.length,
      }))
    );
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// 유저 재적립 — 해당 유저의 커밋 이력만 직접 재계산해 포인트/경험치 복구.
// syncState는 repo별 공유라 베이스라인을 리셋하지 않는다(다른 유저 중복 적립
// 방지). recomputeUserSerialized가 전역 폴링락으로 직렬화하므로 진행 중 폴링과
// 충돌하지 않는다. 비커밋 포인트는 의도적으로 초기화된다.
adminRoutes.post("/users/:id/recompute", async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    const result = await recomputeUserSerialized(req.params.id);
    res.json(result);
  } catch (err) {
    log.error({ err }, "Admin recompute error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 시스템 활동 로그 조회 — 필터(userId/type/since/until) + 페이지네이션(limit/offset).
// 최신순 반환. query()에 위임하고 limit은 모듈에서 상한이 걸린다.
adminRoutes.get("/event-log", async (req, res) => {
  try {
    const { userId, type, since, until, limit, offset } = req.query;
    const result = await queryEventLog({
      userId: typeof userId === "string" && userId ? userId : undefined,
      type: typeof type === "string" && type ? type : undefined,
      since: typeof since === "string" && since ? since : undefined,
      until: typeof until === "string" && until ? until : undefined,
      limit: typeof limit === "string" ? Number(limit) : undefined,
      offset: typeof offset === "string" ? Number(offset) : undefined,
    });
    res.json(result);
  } catch (err) {
    log.error({ err }, "Admin event-log query error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// Manual polling
adminRoutes.post("/polling/run", async (_req, res) => {
  try {
    await pollAllRepos();
    res.json({ ok: true, message: "Polling 완료" });
  } catch (err) {
    res.status(500).json({ error: "Polling 실패" });
  }
});

// ========== 테스트/디버그 명령어 ==========

// 가짜 커밋 이벤트 발생 — 해당 유저에게 바이트 기반 보상 지급
adminRoutes.post("/test/commit", async (req, res) => {
  try {
    const { userId, bytes } = req.body;
    if (!userId || !bytes) return res.status(400).json({ error: "userId, bytes 필요" });

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    const config = await getConfig();

    // 콤보 판정
    const comboResult = judgeCombo(
      user.combo.lastCommitAt ? user.combo : null,
      bytes,
      new Date().toISOString(),
      config.rewards.combo
    );
    user.combo = { count: comboResult.count, lastCommitAt: comboResult.lastCommitAt };
    const multiplier = getComboMultiplier(user.combo.count, config.rewards.combo);

    // 보상 계산
    const reward = calculateReward(bytes, multiplier, config.rewards);
    user.points += reward.points;
    user.totalExp += reward.exp;
    const currentRegion = user.currentRegion ?? "default";

    // 파티 경험치 분배
    if (user.party.length > 0) {
      const expPerPoke = Math.floor(reward.exp / user.party.length);
      const partyPokemon = getPartyPokemon(user);

      for (const poke of partyPokemon) {
        poke.exp += expPerPoke;
        const result = checkLevelUp(poke);
        if (result.leveled) {
          poke.level = result.newLevel;
          applyLearnedMoves(poke, result.newMoves);
          const newStats = calculateStatsForLevel(poke.species, result.newLevel, poke.nature);
          poke.maxHp = newStats.maxHp;
          poke.hp = Math.min(poke.hp, poke.maxHp);
          poke.stats = newStats.stats;
          const matchingBranches = getMatchingEvolutionBranches(
            poke.species,
            {
              level: result.newLevel,
              ...buildLevelEvolutionContext(poke, partyPokemon, {
                now: new Date(),
                region: currentRegion,
              }),
            },
          );
          if (matchingBranches.length === 1) {
            const evolvedBranch = matchingBranches[0];
            clearPendingEvolutionForPokemon(user, poke.uid);
            evolvePokemon(poke, evolvedBranch.targetSpecies, evolvedBranch.targetVariantId);
            if (!user.pokedex.includes(evolvedBranch.targetSpecies)) user.pokedex.push(evolvedBranch.targetSpecies);
          } else if (matchingBranches.length > 1) {
            queuePendingEvolution(user, poke, matchingBranches);
          }
        }
      }
    }

    // 조우 판정
    const { checkEncounter } = await import("../game/encounter.js");
    const encounterResult = checkEncounter(
      user.encounterCeiling.accumulatedBytes,
      bytes,
      config.rewards.encounter.baseChance,
      multiplier,
      config.rewards.encounter.ceilingBytes
    );
    user.encounterCeiling.accumulatedBytes = encounterResult.newCeiling;

    let encounterInfo: { species: string; level: number } | null = null;
    if (encounterResult.encountered) {
      const regionData = getRegion(currentRegion);
      const pick = selectWildPokemon(regionData);
      const partyLevels = getPartyPokemon(user).map((p) => p.level);
      const wildLevel = scaleWildLevel(pick.level, partyLevels, pick.minLevel);
      const wildPokemon = createWildPokemon(pick.species, wildLevel);

      const event = createEncounterEvent(wildPokemon, config.rewards.encounter.timeLimitHours);
      user.pendingEvents.push(event);
      encounterInfo = { species: pick.species, level: wildLevel };
    }

    // 로그
    user.log.push({
      type: "reward",
      commit: "test-" + crypto.randomUUID().slice(0, 8),
      repo: "test",
      bytes,
      exp: reward.exp,
      points: reward.points,
      comboMultiplier: multiplier,
      timestamp: new Date().toISOString(),
    });
    if (user.log.length > 200) user.log = user.log.slice(-200);

    await saveUser(user);
    res.json({
      ok: true, exp: reward.exp, points: reward.points,
      combo: user.combo.count, multiplier,
      encounter: encounterInfo,
    });
  } catch (err) {
    log.error({ err }, "Admin route error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 야생 조우 강제 발생
adminRoutes.post("/test/encounter", async (req, res) => {
  try {
    const { userId, species, level } = req.body;
    if (!userId) return res.status(400).json({ error: "userId 필요" });

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    const config = await getConfig();

    // species/level 지정 가능, 미지정 시 랜덤
    let wildSpecies = species;
    let wildLevel = level;
    if (!wildSpecies) {
      const regionData = getRegion(user.currentRegion ?? "default");
      const pick = selectWildPokemon(regionData);
      const partyLevels = getPartyPokemon(user).map((p) => p.level);
      wildSpecies = pick.species;
      wildLevel = scaleWildLevel(pick.level, partyLevels, pick.minLevel);
    }
    if (!wildLevel) wildLevel = 5;

    const wildPokemon = createWildPokemon(wildSpecies, wildLevel);

    const event = createEncounterEvent(wildPokemon, config.rewards.encounter.timeLimitHours);
    user.pendingEvents.push(event);
    await saveUser(user);

    res.json({ ok: true, event: { id: event.id, species: wildSpecies, level: wildLevel, expiresAt: event.expiresAt } });
  } catch (err) {
    log.error({ err }, "Admin route error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 포인트 직접 지급
adminRoutes.post("/test/give-points", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || amount == null) return res.status(400).json({ error: "userId, amount 필요" });

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    user.points += amount;
    await saveUser(user, "admin-adjust");
    res.json({ ok: true, points: user.points });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// 아이템 직접 지급
adminRoutes.post("/test/give-item", async (req, res) => {
  try {
    const { userId, item, quantity } = req.body;
    if (!userId || !item) return res.status(400).json({ error: "userId, item 필요" });

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    incrementItem(user.inventory, item, quantity || 1);
    await saveUser(user);
    res.json({ ok: true, inventory: user.inventory });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// 포켓몬 직접 지급
adminRoutes.post("/test/give-pokemon", async (req, res) => {
  try {
    const { userId, species, level, hasGigantamaxFactor } = req.body;
    if (!userId || !species) return res.status(400).json({ error: "userId, species 필요" });

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    const pokemon = createPokemon(species, level || 5);
    if (typeof hasGigantamaxFactor === "boolean") {
      pokemon.hasGigantamaxFactor = hasGigantamaxFactor;
    }
    user.pokemon.push(pokemon);
    if (user.party.length < 6) {
      user.party.push(pokemon.uid);
    } else {
      user.storage.push(pokemon);
    }
    if (!user.pokedex.includes(species)) user.pokedex.push(species);

    await saveUser(user);
    res.json({
      ok: true,
      pokemon: {
        uid: pokemon.uid,
        species,
        level: pokemon.level,
        hasGigantamaxFactor: pokemon.hasGigantamaxFactor ?? false,
      },
    });
  } catch (err) {
    log.error({ err }, "Admin route error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 전투 상태 초기화
adminRoutes.post("/test/clear-battle", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId 필요" });

    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    user.battleState = null;
    await saveUser(user);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});
