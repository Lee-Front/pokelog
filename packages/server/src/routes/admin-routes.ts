import { Router } from "express";
import crypto from "node:crypto";
import { getConfig, saveConfig } from "../storage/config-store.js";
import { getUser, saveUser, getAllUsers } from "../storage/user-store.js";
import { pollAllRepos } from "../polling/polling-worker.js";
import { calculateReward } from "../game/reward.js";
import { judgeCombo, getComboMultiplier } from "../game/combo.js";
import { selectWildPokemon } from "../game/encounter.js";
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

import { adminMiddleware } from "../middleware/admin-middleware.js";

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
  "rewards.encounter.baseChance",
  "rewards.encounter.ceilingBytes",
  "rewards.encounter.timeLimitHours",
  "meta.serverName",
  "meta.displayName",
  "meta.apiVersion",
  "meta.featureFlags.pvp",
  "meta.featureFlags.trade",
  "meta.featureFlags.achievements",
  "meta.featureFlags.regions",
]);

// Set config value
adminRoutes.put("/config", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "key가 필요합니다" });

    if (!ALLOWED_CONFIG_PATHS.has(key)) {
      return res.status(400).json({ error: "허용되지 않는 설정 키입니다" });
    }

    const config = await getConfig();
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

// List users
adminRoutes.get("/users", async (_req, res) => {
  try {
    const users = await getAllUsers();
    res.json(
      users.map((u) => ({ id: u.account.id, nickname: u.account.nickname }))
    );
  } catch {
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
      const wildPokemon = createWildPokemon(pick.species, pick.level);

      const event = createEncounterEvent(wildPokemon, config.rewards.encounter.timeLimitHours);
      user.pendingEvents.push(event);
      encounterInfo = { species: pick.species, level: pick.level };
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
    console.error(err);
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
      wildSpecies = pick.species;
      wildLevel = pick.level;
    }
    if (!wildLevel) wildLevel = 5;

    const wildPokemon = createWildPokemon(wildSpecies, wildLevel);

    const event = createEncounterEvent(wildPokemon, config.rewards.encounter.timeLimitHours);
    user.pendingEvents.push(event);
    await saveUser(user);

    res.json({ ok: true, event: { id: event.id, species: wildSpecies, level: wildLevel, expiresAt: event.expiresAt } });
  } catch (err) {
    console.error(err);
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
    await saveUser(user);
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
    console.error(err);
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
