import { Router } from "express";
import crypto from "node:crypto";
import { getConfig, saveConfig } from "../storage/config-store.js";
import { getUser, saveUser, getAllUsers } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { pollAllRepos } from "../polling/polling-worker.js";
import { selectWildPokemon } from "../game/encounter.js";
import { createWildPokemon, createPokemon } from "../game/pokemon-factory.js";
import { getRegion } from "../game/data-loader.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { incrementItem } from "../game/inventory-utils.js";
import { applyCommitRewards } from "../game/commit-rewards.js";
import { INTEGRATION_EVENT_CATALOG } from "../integrations/event-catalog.js";

import { adminMiddleware } from "../middleware/admin-middleware.js";

export const adminRoutes = Router();
adminRoutes.use(adminMiddleware);

const startTime = Date.now();

// Add repo
adminRoutes.post("/repo", async (req, res) => {
  try {
    const { url, branches } = req.body;
    if (!url) {
      res.status(400).json({ error: "url이 필요합니다" });
      return;
    }

    const config = await getConfig();
    const exists = config.polling.repos.some((r) => r.url === url);
    if (exists) {
      res.status(409).json({ error: "이미 등록된 repo입니다" });
      return;
    }

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

type ConfigValueType = "number" | "string" | "boolean";

// Declared type per allowed config path. Used to reject obviously-wrong
// values (e.g. flipping a boolean flag to the string "true") before we
// persist them. Keep in lockstep with ServerConfig in shared/types.ts.
const CONFIG_SCHEMA: Record<string, ConfigValueType> = {
  "polling.intervalMinutes": "number",
  "rewards.expPerByte": "number",
  "rewards.pointsPerByte": "number",
  "rewards.combo.bytesPerMinute": "number",
  "rewards.combo.maxMultiplier": "number",
  "rewards.encounter.baseChance": "number",
  "rewards.encounter.ceilingBytes": "number",
  "rewards.encounter.timeLimitHours": "number",
  "meta.serverName": "string",
  "meta.displayName": "string",
  "meta.apiVersion": "string",
  "meta.featureFlags.pvp": "boolean",
  "meta.featureFlags.trade": "boolean",
  "meta.featureFlags.achievements": "boolean",
  "meta.featureFlags.regions": "boolean",
};

const ALLOWED_CONFIG_PATHS = new Set(Object.keys(CONFIG_SCHEMA));

/**
 * Walk `obj` down a dotted path and set the leaf to `value`. Refuses any
 * key that could land inside Object.prototype / constructor / __proto__ —
 * rejecting prototype-pollution attempts even though the allowed-paths
 * whitelist already prevents them in principle.
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  if (keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) {
    throw new Error("Invalid path");
  }
  let target: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = target[keys[i]];
    if (!next || typeof next !== "object") {
      // Don't silently create parent objects for admin config — a missing
      // intermediate means the config shape drifted, which we'd rather
      // surface than silently fix up.
      throw new Error(`Invalid path: ${path}`);
    }
    target = next as Record<string, unknown>;
  }
  target[keys[keys.length - 1]] = value;
}

// Set config value
adminRoutes.put("/config", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      res.status(400).json({ error: "key가 필요합니다" });
      return;
    }

    if (!ALLOWED_CONFIG_PATHS.has(key)) {
      res.status(400).json({ error: "허용되지 않는 설정 키입니다" });
      return;
    }

    const expectedType = CONFIG_SCHEMA[key];
    if (expectedType && typeof value !== expectedType) {
      res.status(400).json({
        error: `Value must be ${expectedType}, got ${typeof value}`,
      });
      return;
    }

    const config = await getConfig();
    try {
      setByPath(config as unknown as Record<string, unknown>, key, value);
    } catch (err) {
      const message = err instanceof Error ? err.message : "잘못된 경로";
      res.status(400).json({ error: message });
      return;
    }
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
//
// These endpoints let an operator mint points, items, or pokemon — they
// exist purely for local development and QA. We disable them by default
// in production. An operator who really needs them on a live deploy can
// opt-in with POKELOG_ENABLE_ADMIN_TEST=1 (still gated behind the admin
// key via adminMiddleware).
const ADMIN_TEST_ENABLED =
  process.env.NODE_ENV !== "production"
  || process.env.POKELOG_ENABLE_ADMIN_TEST === "1";

if (ADMIN_TEST_ENABLED) {

// 가짜 커밋 이벤트 발생 — 해당 유저에게 바이트 기반 보상 지급
adminRoutes.post("/test/commit", async (req, res) => {
  try {
    const { userId, bytes } = req.body;
    if (!userId || !bytes) {
      res.status(400).json({ error: "userId, bytes 필요" });
      return;
    }

    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) {
        res.status(404).json({ error: "유저 없음" });
        return;
      }

      const config = await getConfig();
      const timestamp = new Date().toISOString();
      const outcome = applyCommitRewards(user, bytes, config, { timestamp });

      // 로그 (admin-test 전용 커밋 해시 형태를 그대로 유지)
      user.log.push({
        type: "reward",
        commit: "test-" + crypto.randomUUID().slice(0, 8),
        repo: "test",
        bytes,
        exp: outcome.expAwarded,
        points: outcome.pointsAwarded,
        comboMultiplier: outcome.multiplier,
        timestamp,
      });
      if (user.log.length > 200) user.log = user.log.slice(-200);

      await saveUser(user);
      res.json({
        ok: true,
        exp: outcome.expAwarded,
        points: outcome.pointsAwarded,
        combo: outcome.comboCount,
        multiplier: outcome.multiplier,
        encounter: outcome.encounter,
      });
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
    if (!userId) {
      res.status(400).json({ error: "userId 필요" });
      return;
    }

    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) {
        res.status(404).json({ error: "유저 없음" });
        return;
      }

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
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 포인트 직접 지급
adminRoutes.post("/test/give-points", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || amount == null) {
      res.status(400).json({ error: "userId, amount 필요" });
      return;
    }

    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) {
        res.status(404).json({ error: "유저 없음" });
        return;
      }

      user.points += amount;
      await saveUser(user);
      res.json({ ok: true, points: user.points });
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

adminRoutes.post("/test/give-bp", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || amount == null) {
      res.status(400).json({ error: "userId, amount 필요" });
      return;
    }
    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) {
        res.status(404).json({ error: "유저 없음" });
        return;
      }
      user.bp = (user.bp ?? 0) + Number(amount);
      await saveUser(user);
      res.json({ ok: true, bp: user.bp });
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// 아이템 직접 지급
adminRoutes.post("/test/give-item", async (req, res) => {
  try {
    const { userId, item, quantity } = req.body;
    if (!userId || !item) {
      res.status(400).json({ error: "userId, item 필요" });
      return;
    }

    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) {
        res.status(404).json({ error: "유저 없음" });
        return;
      }

      incrementItem(user.inventory, item, quantity || 1);
      await saveUser(user);
      res.json({ ok: true, inventory: user.inventory });
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// 포켓몬 직접 지급
adminRoutes.post("/test/give-pokemon", async (req, res) => {
  try {
    const { userId, species, level, hasGigantamaxFactor } = req.body;
    if (!userId || !species) {
      res.status(400).json({ error: "userId, species 필요" });
      return;
    }

    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) {
        res.status(404).json({ error: "유저 없음" });
        return;
      }

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
    if (!userId) {
      res.status(400).json({ error: "userId 필요" });
      return;
    }

    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) {
        res.status(404).json({ error: "유저 없음" });
        return;
      }

      user.battleState = null;
      await saveUser(user);
      res.json({ ok: true });
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

} // end if (ADMIN_TEST_ENABLED)
