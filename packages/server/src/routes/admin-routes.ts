import { Router } from "express";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { getDataDir } from "../paths.js";
import { getRepoAuthors } from "../polling/git-client.js";
import { getConfig, saveConfig } from "../storage/config-store.js";
import { getUser, saveUser, getAllUsers, deleteUser } from "../storage/user-store.js";
import { hashPassword, issueToken } from "../auth/auth.js";
import { withLock } from "../storage/pvp-store.js";
import { resetGameData } from "../game/game-reset.js";
import { getSpeciesByName } from "../game/data-loader.js";
import {
  getAnnouncements,
  createAnnouncement,
  setAnnouncementActive,
  deleteAnnouncement,
} from "../storage/announcement-store.js";
import { pollAllRepos, recomputeUserSerialized } from "../polling/polling-worker.js";
import { calculateReward } from "../game/reward.js";
import { judgeCombo, getComboMultiplier } from "../game/combo.js";
import { createPokemon } from "../game/pokemon-factory.js";
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
import type { ServerConfig, UserData } from "../../../../shared/types.js";
import { INTEGRATION_EVENT_CATALOG } from "../integrations/event-catalog.js";
import { clearPendingEvolutionForPokemon, queuePendingEvolution } from "../game/pending-evolution.js";
import { queuePendingMoveLearns } from "../game/pending-move-learn.js";

import { query as queryEventLog } from "../storage/event-log.js";
import { adminMiddleware } from "../middleware/admin-middleware.js";
import { buildWorldBossWild } from "../game/world-boss.js";
import { getDisplaySpeciesName } from "../game/pokemon-state.js";
import { getWorldBoss, setWorldBoss, mutateWorldBoss } from "../storage/world-boss-store.js";
import type { WorldBossState } from "../../../../shared/types.js";
import { childLogger } from "../logger.js";

const log = childLogger("admin-routes");

export const adminRoutes = Router();
adminRoutes.use(adminMiddleware);

const startTime = Date.now();

// 지급 가능한 아이템인지 — 인벤토리/상점 네임스페이스(config.shop/battleShop의 키)
// 기준으로 검증한다. items.json(getItemById)은 별도 카탈로그 id 체계(예: "poke-ball")라
// 인벤토리 키("pokeball")와 다르므로 쓰지 않는다.
async function isGrantableItem(itemId: string): Promise<boolean> {
  const config = await getConfig();
  return itemId in config.shop.items || itemId in config.battleShop.items;
}

// 운영 UI에 내려줄 개체 포켓몬 요약 — 카드/편집폼에 쓰는 필드만.
function summarizePokemon(p: {
  uid: string;
  species: string;
  nickname: string | null;
  level: number;
  hp: number;
  maxHp: number;
  isShiny?: boolean;
}): { uid: string; species: string; nickname: string | null; level: number; hp: number; maxHp: number; shiny: boolean } {
  return {
    uid: p.uid,
    species: p.species,
    nickname: p.nickname ?? null,
    level: p.level,
    hp: p.hp,
    maxHp: p.maxHp,
    shiny: p.isShiny ?? false,
  };
}

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
  // 무료 일괄 야생 롤이 한 번에 생성하는 조우 개수(1~50).
  "rewards.encounter.rollCount",
  // 롤 1회당 전설/환상이 끼어들 확률(0~1).
  "rewards.encounter.wildLegendaryChance",
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

    // 일괄 야생 롤 개수 — 1~50의 정수.
    if (key === "rewards.encounter.rollCount") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) {
        return res.status(400).json({ error: "rollCount는 1~50 사이의 정수여야 합니다" });
      }
    }

    // 야생 전설 등장 확률 — 0~1 사이의 실수.
    if (key === "rewards.encounter.wildLegendaryChance") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        return res.status(400).json({ error: "wildLegendaryChance는 0~1 사이의 숫자여야 합니다" });
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

// ========== SSO 프로비저닝 (계정 배부) ==========

// 외부 포털(CompanyHub)이 자기 유저에게 PokeLog 계정을 1:1로 배부한다. loginId로
// 계정이 없으면 랜덤 비밀번호로 생성(register와 동일한 초기 상태)하고, 있으면 멱등하게
// 처리한다. 어느 경우든 admin 권한으로 JWT를 발급해 반환하므로 포털은 별도 로그인 없이
// 그 토큰으로 게임 API를 프록시할 수 있다. 비밀번호는 포털에 노출되지 않는다.
const PROVISION_DEFAULT_STARTER = "bulbasaur";
// register와 동일한 스타터 화이트리스트 (auth-routes의 VALID_STARTERS와 일치).
const VALID_STARTERS = ["bulbasaur", "charmander", "squirtle"];

adminRoutes.post("/provision", async (req, res) => {
  try {
    const { loginId, nickname, starter } = req.body ?? {};

    if (typeof loginId !== "string" || !loginId.trim()) {
      return res.status(400).json({ error: "loginId가 필요합니다" });
    }
    const id = loginId.trim();
    // PokeLog 계정 id 규칙(register와 동일) — 영문/숫자만.
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      return res.status(400).json({ error: "loginId는 영문/숫자만 가능합니다" });
    }

    const existing = await getUser(id);
    if (existing) {
      // 멱등 — 이미 배부된 계정. 비밀번호를 모르므로 admin 권한으로 토큰만 재발급한다.
      const token = issueToken(id);
      return res.json({ pokelogId: id, token, created: false });
    }

    // 신규 계정 — register 로직을 재사용해 동일한 초기 상태로 만든다. 비밀번호는
    // 포털이 쓰지 않으므로 임의 난수로 채운다(로그인은 발급 토큰으로 대체).
    const resolvedStarter =
      typeof starter === "string" && VALID_STARTERS.includes(starter)
        ? starter
        : PROVISION_DEFAULT_STARTER;
    const resolvedNickname =
      typeof nickname === "string" && nickname.trim() ? nickname.trim() : id;

    const hashedPassword = await hashPassword(crypto.randomUUID());
    const starterPokemon = createPokemon(resolvedStarter, 5);

    const userData: UserData = {
      account: {
        id,
        password: hashedPassword,
        nickname: resolvedNickname,
        createdAt: new Date().toISOString(),
        matchings: {},
      },
      currentRegion: "default",
      points: 0,
      gameMoney: 0,
      totalExp: 0,
      combo: { count: 0, lastCommitAt: null },
      party: [starterPokemon.uid],
      pokemon: [starterPokemon],
      eggs: [],
      pokedex: [resolvedStarter],
      inventory: { pokeball: 5 },
      pendingEvents: [],
      pendingEvolutions: [],
      pendingMoveLearns: [],
      battleState: null,
      storage: [],
      log: [],
      integrations: [],
    };

    await saveUser(userData);
    const token = issueToken(id);
    res.status(201).json({ pokelogId: id, token, created: true });
  } catch (err) {
    log.error({ err }, "Admin provision error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// ========== 운영(어드민) 유저 도구 ==========

// 유저 전체 스냅샷 — 운영자가 한 유저의 계정·재화·보유물·연동을 한눈에 본다.
// 파티/연동은 요약(민감정보 토큰은 내리지 않음), 보관함/도감/인벤토리는 개수·맵.
adminRoutes.get("/users/:id", async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    res.json({
      account: { id: user.account.id, nickname: user.account.nickname, createdAt: user.account.createdAt },
      points: user.points,
      totalExp: user.totalExp,
      gameMoney: user.gameMoney,
      currentRegion: user.currentRegion ?? "default",
      party: user.party
        .map((uid) => user.pokemon.find((p) => p.uid === uid))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({ uid: p.uid, species: p.species, level: p.level, shiny: p.isShiny ?? false })),
      // 편집/삭제 UI용 전체 보유 목록 — 파티(user.pokemon)와 보관함(user.storage)을
      // 합쳐 inParty 플래그로 구분. 편집폼에 필요한 최소 필드만(닉네임·레벨·이로치·종).
      pokemonList: [
        ...user.pokemon.map((p) => ({ ...summarizePokemon(p), inParty: user.party.includes(p.uid) })),
        ...user.storage.map((p) => ({ ...summarizePokemon(p), inParty: false })),
      ],
      pokemonCount: user.pokemon.length,
      storageCount: user.storage.length,
      eggCount: user.eggs.length,
      pokedexCount: user.pokedex.length,
      inventory: user.inventory,
      // 연동은 종류·라벨·상태·이메일만(토큰 등 비밀은 제외).
      integrations: user.integrations.map((i) => ({
        provider: i.provider,
        label: i.label,
        status: i.status,
        emails: "emails" in i ? (i.emails ?? []) : [],
      })),
      battleState: user.battleState ? { eventId: user.battleState.eventId, turn: user.battleState.turn } : null,
    });
  } catch (err) {
    log.error({ err }, "Admin user snapshot error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// ========== git 작성자 후보(연동된 repo 클론에서 스크랩) ==========

// 모든 bare clone을 매 요청마다 스캔하는 건 비싸므로 모듈 전역에 짧은 TTL 캐시를
// 둔다. 키는 없음(전역) — 운영자가 계정 배부 화면을 열 때 잠깐 쓰는 후보 목록이라
// 5분이면 충분하다.
interface CachedAuthors {
  data: Array<{ email: string; name: string; count: number; repos: number }>;
  expiresAt: number;
}
let gitAuthorsCache: CachedAuthors | null = null;
const GIT_AUTHORS_TTL_MS = 5 * 60 * 1000;

// pokelog-data/repos/ 아래의 bare clone 디렉터리들을 훑어 작성자 이메일을 합친다.
// 각 디렉터리에서 getRepoAuthors로 (email,name,count)를 얻고, 이메일(소문자)별로
// count를 합산하면서 그 이메일이 등장한 repo 수(repos)도 센다. count 내림차순 정렬.
async function scanGitAuthors(): Promise<CachedAuthors["data"]> {
  const reposDir = path.join(getDataDir(), "repos");
  let names: string[];
  try {
    names = await fs.readdir(reposDir);
  } catch {
    // repos 디렉터리 자체가 없으면(아직 폴링 전) 후보 없음.
    return [];
  }

  // email(소문자) → 합산 정보. name은 가장 큰 단일 repo count를 낸 이름으로 유지.
  const merged = new Map<
    string,
    { name: string; nameCount: number; count: number; repos: number }
  >();

  for (const name of names) {
    const repoDir = path.join(reposDir, name);
    // 디렉터리가 아니거나 bare repo가 아니면(HEAD 없음) 건너뛴다. stat + HEAD 접근
    // 둘 다 실패를 관용 처리한다.
    try {
      const stat = await fs.stat(repoDir);
      if (!stat.isDirectory()) continue;
      await fs.access(path.join(repoDir, "HEAD"));
    } catch {
      continue;
    }
    const authors = await getRepoAuthors(repoDir);
    for (const a of authors) {
      const existing = merged.get(a.email);
      if (!existing) {
        merged.set(a.email, { name: a.name, nameCount: a.count, count: a.count, repos: 1 });
      } else {
        existing.count += a.count;
        existing.repos += 1;
        // 더 많은 커밋을 낸 repo의 이름을 대표 이름으로 채택.
        if (a.name && a.count > existing.nameCount) {
          existing.name = a.name;
          existing.nameCount = a.count;
        }
      }
    }
  }

  return [...merged.entries()]
    .map(([email, { name, count, repos }]) => ({ email, name, count, repos }))
    .sort((a, b) => b.count - a.count);
}

// 연동(폴링)된 repo 클론에서 추출한 git 작성자 후보 목록. 운영자가 계정 배부 화면에서
// 사람별 이메일을 손으로 치지 않고 골라 쓰도록 surface한다. 결과는 5분 캐시.
adminRoutes.get("/git-authors", async (_req, res) => {
  try {
    const now = Date.now();
    if (gitAuthorsCache && gitAuthorsCache.expiresAt > now) {
      return res.json({ authors: gitAuthorsCache.data });
    }
    const data = await scanGitAuthors();
    gitAuthorsCache = { data, expiresAt: now + GIT_AUTHORS_TTL_MS };
    res.json({ authors: data });
  } catch (err) {
    log.error({ err }, "Admin git-authors error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// git 작성자 이메일 조회 — 커밋 귀속(userMatchesRepoCommit)이 매칭하는 이메일 목록.
// account.matchings.git이 없으면 빈 배열.
adminRoutes.get("/users/:id/git-emails", async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "유저 없음" });
    res.json({ emails: user.account.matchings?.git?.emails ?? [] });
  } catch (err) {
    log.error({ err }, "Admin git-emails get error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// git 작성자 이메일 설정 — 운영자가 계정별로 커밋 귀속 이메일을 수동 지정한다.
// 정규화: 트림·소문자·빈값 제거·중복 제거·'@' 포함(그럴듯한 이메일)만 유지.
// matchings.git의 형제 필드는 건드리지 않고 .emails만 교체한다(현재 GitMatching은
// emails 단일 필드이나 구조 보존을 위해 방어적으로 작성).
adminRoutes.put("/users/:id/git-emails", async (req, res) => {
  try {
    const { emails } = req.body ?? {};
    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: "emails는 배열이어야 합니다" });
    }

    await withLock(`user:${req.params.id}`, async () => {
      const user = await getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      const normalized = Array.from(
        new Set(
          emails
            .filter((e): e is string => typeof e === "string")
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.length > 0 && e.includes("@"))
        )
      );

      user.account.matchings = user.account.matchings ?? {};
      user.account.matchings.git = user.account.matchings.git ?? { emails: [] };
      user.account.matchings.git.emails = normalized;

      await saveUser(user);
      res.json({ ok: true, emails: normalized });
    });
  } catch (err) {
    log.error({ err }, "Admin git-emails set error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 재화 조정 — points/totalExp/gameMoney 각각 set 또는 add(한 필드당 하나만).
// 결과가 음수면 0으로 클램프. 잔액 하락이 의도된 운영 작업이므로 "admin-adjust"로 저장.
adminRoutes.post("/users/:id/adjust", async (req, res) => {
  try {
    await withLock(`user:${req.params.id}`, async () => {
      const user = await getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      const fields = [
        { name: "Points", target: "points" },
        { name: "TotalExp", target: "totalExp" },
        { name: "GameMoney", target: "gameMoney" },
      ] as const;

      for (const { name, target } of fields) {
        const setVal = req.body[`set${name}`];
        const addVal = req.body[`add${name}`];
        if (setVal != null && addVal != null) {
          return res.status(400).json({ error: `set${name}와 add${name}는 동시에 줄 수 없습니다` });
        }
        if (setVal != null) {
          if (typeof setVal !== "number" || !Number.isFinite(setVal)) {
            return res.status(400).json({ error: `set${name}는 숫자여야 합니다` });
          }
          user[target] = Math.max(0, setVal);
        } else if (addVal != null) {
          if (typeof addVal !== "number" || !Number.isFinite(addVal)) {
            return res.status(400).json({ error: `add${name}는 숫자여야 합니다` });
          }
          user[target] = Math.max(0, user[target] + addVal);
        }
      }

      await saveUser(user, "admin-adjust");
      res.json({ ok: true, points: user.points, totalExp: user.totalExp, gameMoney: user.gameMoney });
    });
  } catch (err) {
    log.error({ err }, "Admin adjust error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 아이템 지급(정식) — 존재하는 item id 검증. 수량 미지정 시 1.
adminRoutes.post("/users/:id/give-item", async (req, res) => {
  try {
    const { item, qty } = req.body;
    if (!item) return res.status(400).json({ error: "item 필요" });
    if (!(await isGrantableItem(item))) return res.status(400).json({ error: "존재하지 않는 아이템입니다" });
    const quantity = qty ?? 1;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "qty는 양수여야 합니다" });
    }

    await withLock(`user:${req.params.id}`, async () => {
      const user = await getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      incrementItem(user.inventory, item, quantity);
      await saveUser(user);
      res.json({ ok: true, inventory: user.inventory });
    });
  } catch (err) {
    log.error({ err }, "Admin give-item error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 포켓몬 지급(정식) — 존재하는 species 검증. 파티 여유 있으면 파티에, 아니면 보관함.
adminRoutes.post("/users/:id/give-pokemon", async (req, res) => {
  try {
    const { species, level, shiny } = req.body;
    if (!species) return res.status(400).json({ error: "species 필요" });
    if (!getSpeciesByName(species)) return res.status(400).json({ error: "존재하지 않는 포켓몬입니다" });

    await withLock(`user:${req.params.id}`, async () => {
      const user = await getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      const pokemon = createPokemon(species, level ?? 5);
      if (typeof shiny === "boolean") pokemon.isShiny = shiny;
      if (user.party.length < 6) {
        user.pokemon.push(pokemon);
        user.party.push(pokemon.uid);
      } else user.storage.push(pokemon);
      if (!user.pokedex.includes(pokemon.species)) user.pokedex.push(pokemon.species);

      await saveUser(user);
      res.json({
        ok: true,
        pokemon: { uid: pokemon.uid, species: pokemon.species, level: pokemon.level, shiny: pokemon.isShiny ?? false },
      });
    });
  } catch (err) {
    log.error({ err }, "Admin give-pokemon error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 개체 포켓몬 수정 — 닉네임/레벨/이로치/종. 레벨 또는 종이 바뀌면 스탯·maxHp를
// calculateStatsForLevel로 재계산하고 현재 hp를 새 maxHp로 클램프한다(레벨/종 변경 시
// 현재 hp가 새 최대치보다 클 수 있으므로). 종 변경 시 존재 검증 + 도감 갱신.
// 파티(user.pokemon)·보관함(user.storage) 어디에 있든 uid로 찾아 같은 객체를 수정한다.
adminRoutes.patch("/users/:id/pokemon/:uid", async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    const mon =
      user.pokemon.find((p) => p.uid === req.params.uid) ??
      user.storage.find((p) => p.uid === req.params.uid);
    if (!mon) return res.status(404).json({ error: "포켓몬 없음" });

    const { nickname, level, shiny, species } = req.body ?? {};

    // 닉네임 — 문자열이면 트림 후 빈 문자열은 null(닉네임 해제), null도 허용.
    if (nickname !== undefined) {
      if (nickname === null) {
        mon.nickname = null;
      } else if (typeof nickname === "string") {
        const trimmed = nickname.trim();
        mon.nickname = trimmed === "" ? null : trimmed;
      } else {
        return res.status(400).json({ error: "nickname은 문자열이어야 합니다" });
      }
    }

    if (shiny !== undefined) {
      if (typeof shiny !== "boolean") return res.status(400).json({ error: "shiny는 boolean이어야 합니다" });
      mon.isShiny = shiny;
    }

    // 종 변경 — 존재 검증. 종이 바뀌면 variantId는 초기화(폼 변형은 새 종 기준 무의미).
    let speciesChanged = false;
    if (species !== undefined) {
      if (typeof species !== "string" || !species.trim()) {
        return res.status(400).json({ error: "species는 비어있지 않은 문자열이어야 합니다" });
      }
      const sp = species.trim();
      if (!getSpeciesByName(sp)) return res.status(400).json({ error: "존재하지 않는 포켓몬입니다" });
      if (sp !== mon.species) {
        mon.species = sp;
        mon.variantId = null;
        speciesChanged = true;
        if (!user.pokedex.includes(sp)) user.pokedex.push(sp);
      }
    }

    // 레벨 변경 — 1~100 정수.
    let levelChanged = false;
    if (level !== undefined) {
      const lv = Number(level);
      if (!Number.isInteger(lv) || lv < 1 || lv > 100) {
        return res.status(400).json({ error: "레벨은 1~100 정수여야 합니다" });
      }
      if (lv !== mon.level) {
        mon.level = lv;
        levelChanged = true;
      }
    }

    // 레벨/종이 바뀌면 스탯·maxHp 재계산. hp는 새 maxHp로 클램프.
    if (levelChanged || speciesChanged) {
      const recalced = calculateStatsForLevel(mon.species, mon.level, mon.nature, mon.variantId, mon.ivs, mon.evs);
      mon.maxHp = recalced.maxHp;
      mon.stats = recalced.stats;
      mon.hp = Math.min(mon.hp, mon.maxHp);
    }

    await saveUser(user, "admin-adjust");
    res.json({
      ok: true,
      pokemon: summarizePokemon(mon),
    });
  } catch (err) {
    log.error({ err }, "Admin edit-pokemon error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 개체 포켓몬 삭제 — 파티/보관함 어디서든 제거하고 party 배열도 동기화한다.
// 운영 도구라 마지막 1마리도 강제 삭제 허용하되, 결과적으로 빈 파티가 되면
// 보관함의 첫 포켓몬을 파티로 승격해 "보유는 있는데 파티가 빈" 상태를 막는다.
adminRoutes.delete("/users/:id/pokemon/:uid", async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    const uid = req.params.uid;
    const inPokemon = user.pokemon.some((p) => p.uid === uid);
    const inStorage = user.storage.some((p) => p.uid === uid);
    if (!inPokemon && !inStorage) return res.status(404).json({ error: "포켓몬 없음" });

    user.pokemon = user.pokemon.filter((p) => p.uid !== uid);
    user.storage = user.storage.filter((p) => p.uid !== uid);
    user.party = user.party.filter((id) => id !== uid);

    // 빈 파티 방어 — 보유가 남아있으면 첫 포켓몬을 파티로.
    if (user.party.length === 0 && user.pokemon.length > 0) {
      user.party.push(user.pokemon[0].uid);
    } else if (user.party.length === 0 && user.storage.length > 0) {
      const promoted = user.storage.shift()!;
      user.pokemon.push(promoted);
      user.party.push(promoted.uid);
    }

    await saveUser(user, "admin-adjust");
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Admin delete-pokemon error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 계정 영구 삭제 — 유저 파일·인덱스 제거. 되돌릴 수 없다(게임 리셋과 달리 계정 자체가 사라짐).
// 연동/배부 매핑은 포털 측 데이터라 여기서 건드리지 않는다(필요 시 재배부).
adminRoutes.delete("/users/:id", async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "유저 없음" });

    await deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Admin delete-user error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 게임 데이터 초기화(개별) — 계정·연동 보존. 리셋/보존 필드는 resetGameData 주석 참조.
adminRoutes.post("/users/:id/reset-game", async (req, res) => {
  try {
    await withLock(`user:${req.params.id}`, async () => {
      const user = await getUser(req.params.id);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      resetGameData(user);
      await saveUser(user, "admin-adjust");
      res.json({ ok: true });
    });
  } catch (err) {
    log.error({ err }, "Admin reset-game error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// ========== 일괄 작업 ==========

// 보상 일괄 지급 — 전체(또는 filter 조건) 유저에게 포인트/아이템/포켓몬 지급.
// filter.minPoints/maxPoints는 현재 포인트 기준(포함). 각 유저 저장은 'user:<id>'
// 락으로 직렬화해 폴링 등 다른 쓰기와의 경합을 피한다. 처리/실패 수를 반환.
adminRoutes.post("/broadcast/reward", async (req, res) => {
  try {
    const { points, gameMoney, items, pokemon, filter } = req.body ?? {};

    // 입력 검증 — 존재하지 않는 item/species가 하나라도 있으면 시작 전에 400.
    if (points != null && (typeof points !== "number" || !Number.isFinite(points))) {
      return res.status(400).json({ error: "points는 숫자여야 합니다" });
    }
    if (gameMoney != null && (typeof gameMoney !== "number" || !Number.isFinite(gameMoney))) {
      return res.status(400).json({ error: "gameMoney는 숫자여야 합니다" });
    }
    if (items && typeof items === "object") {
      for (const id of Object.keys(items)) {
        if (!(await isGrantableItem(id))) return res.status(400).json({ error: `존재하지 않는 아이템: ${id}` });
      }
    }
    if (Array.isArray(pokemon)) {
      for (const p of pokemon) {
        if (!p?.species || !getSpeciesByName(p.species)) {
          return res.status(400).json({ error: `존재하지 않는 포켓몬: ${p?.species}` });
        }
      }
    }

    const minPoints = filter?.minPoints;
    const maxPoints = filter?.maxPoints;
    const all = await getAllUsers();
    const targets = all.filter((u) => {
      if (typeof minPoints === "number" && u.points < minPoints) return false;
      if (typeof maxPoints === "number" && u.points > maxPoints) return false;
      return true;
    });

    let processed = 0;
    const failed: string[] = [];
    for (const summary of targets) {
      const id = summary.account.id;
      try {
        await withLock(`user:${id}`, async () => {
          // 락 안에서 최신 유저를 다시 읽어 stale-save 덮어쓰기를 피한다.
          const user = await getUser(id);
          if (!user) return;
          if (typeof points === "number") user.points = Math.max(0, user.points + points);
          if (typeof gameMoney === "number") user.gameMoney = Math.max(0, user.gameMoney + gameMoney);
          if (items && typeof items === "object") {
            for (const [item, qty] of Object.entries(items as Record<string, number>)) {
              if (typeof qty === "number" && qty > 0) incrementItem(user.inventory, item, qty);
            }
          }
          if (Array.isArray(pokemon)) {
            for (const p of pokemon) {
              const mon = createPokemon(p.species, p.level ?? 5);
              if (typeof p.shiny === "boolean") mon.isShiny = p.shiny;
              if (user.party.length < 6) {
                user.pokemon.push(mon);
                user.party.push(mon.uid);
              } else user.storage.push(mon);
              if (!user.pokedex.includes(mon.species)) user.pokedex.push(mon.species);
            }
          }
          // 포인트가 줄 수도(음수 points 지급) 있으므로 admin-adjust로 저장.
          await saveUser(user, "admin-adjust");
        });
        processed++;
      } catch (err) {
        log.error({ err, userId: id }, "Broadcast reward failed for user");
        failed.push(id);
      }
    }

    res.json({ ok: true, matched: targets.length, processed, failed });
  } catch (err) {
    log.error({ err }, "Admin broadcast reward error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 전체 게임 초기화(오픈베타 와이프) — 계정·연동 보존. 파괴적이므로 confirm 가드 필수.
adminRoutes.post("/reset-all-game", async (req, res) => {
  try {
    if (req.body?.confirm !== "RESET-ALL") {
      return res.status(400).json({ error: 'confirm 필드가 "RESET-ALL"이어야 합니다' });
    }

    const all = await getAllUsers();
    let processed = 0;
    const failed: string[] = [];
    for (const summary of all) {
      const id = summary.account.id;
      try {
        await withLock(`user:${id}`, async () => {
          const user = await getUser(id);
          if (!user) return;
          resetGameData(user);
          await saveUser(user, "admin-adjust");
        });
        processed++;
      } catch (err) {
        log.error({ err, userId: id }, "Reset-all failed for user");
        failed.push(id);
      }
    }

    res.json({ ok: true, total: all.length, processed, failed });
  } catch (err) {
    log.error({ err }, "Admin reset-all error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// ========== 공지 ==========

adminRoutes.get("/announcements", async (_req, res) => {
  try {
    res.json({ announcements: await getAnnouncements() });
  } catch (err) {
    log.error({ err }, "Admin announcements list error");
    res.status(500).json({ error: "서버 오류" });
  }
});

adminRoutes.post("/announcements", async (req, res) => {
  try {
    const { title, body } = req.body ?? {};
    if (!title || !body) return res.status(400).json({ error: "title, body 필요" });
    const announcement = await createAnnouncement(String(title), String(body));
    res.status(201).json({ announcement });
  } catch (err) {
    log.error({ err }, "Admin announcement create error");
    res.status(500).json({ error: "서버 오류" });
  }
});

adminRoutes.patch("/announcements/:id", async (req, res) => {
  try {
    const { active } = req.body ?? {};
    if (typeof active !== "boolean") return res.status(400).json({ error: "active(boolean) 필요" });
    const announcement = await setAnnouncementActive(req.params.id, active);
    if (!announcement) return res.status(404).json({ error: "공지 없음" });
    res.json({ announcement });
  } catch (err) {
    log.error({ err }, "Admin announcement patch error");
    res.status(500).json({ error: "서버 오류" });
  }
});

adminRoutes.delete("/announcements/:id", async (req, res) => {
  try {
    const removed = await deleteAnnouncement(req.params.id);
    if (!removed) return res.status(404).json({ error: "공지 없음" });
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Admin announcement delete error");
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

// ========== 월드보스(전 유저 공유체력 공동전) ==========

// 월드보스 스폰 — 관리자 수동. 임의의 종/변종/레벨을 HP 배율(hpMultiplier) 또는 절대값(totalHp)으로
// 뻥튀기해 공유 체력 개체를 만든다(전설/환상 무관하게 허용하되 종/변종 존재는 검증). 진행 중 보스가
// 있으면(active·미처치) 덮어쓰기를 막는다(중복 스폰 방지) — 먼저 /end로 종료해야 한다.
adminRoutes.post("/world-boss/spawn", async (req, res) => {
  try {
    const { species, variantId, level, hpMultiplier, totalHp, durationHours } = req.body ?? {};

    if (typeof species !== "string" || !species.trim()) {
      return res.status(400).json({ error: "species가 필요합니다" });
    }
    const lv = Number(level);
    if (!Number.isInteger(lv) || lv < 1 || lv > 100) {
      return res.status(400).json({ error: "level은 1~100 정수여야 합니다" });
    }
    if (variantId != null && typeof variantId !== "string") {
      return res.status(400).json({ error: "variantId는 문자열이어야 합니다" });
    }
    if (hpMultiplier != null && (typeof hpMultiplier !== "number" || !Number.isFinite(hpMultiplier) || hpMultiplier <= 0)) {
      return res.status(400).json({ error: "hpMultiplier는 양수여야 합니다" });
    }
    if (totalHp != null && (typeof totalHp !== "number" || !Number.isFinite(totalHp) || totalHp <= 0)) {
      return res.status(400).json({ error: "totalHp는 양수여야 합니다" });
    }

    const existing = await getWorldBoss();
    if (existing && existing.active && !existing.defeated) {
      return res.status(409).json({ error: "이미 진행 중인 월드보스가 있습니다. 먼저 종료해주세요." });
    }

    const config = await getConfig();
    const hours = typeof durationHours === "number" && durationHours > 0 ? durationHours : config.worldBoss.durationHours;

    let wild;
    try {
      wild = buildWorldBossWild(species.trim(), typeof variantId === "string" ? variantId : null, lv, {
        hpMultiplier: typeof hpMultiplier === "number" ? hpMultiplier : undefined,
        totalHp: typeof totalHp === "number" ? totalHp : undefined,
      });
    } catch {
      return res.status(400).json({ error: "존재하지 않는 포켓몬/변종입니다" });
    }

    const now = new Date();
    const state: WorldBossState = {
      active: true,
      bossId: crypto.randomUUID(),
      species: wild.species,
      variantId: wild.variantId ?? null,
      level: wild.level,
      name: getDisplaySpeciesName(wild.species),
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + hours * 3600000).toISOString(),
      globalMaxHp: wild.maxHp,
      globalHp: wild.maxHp,
      defeated: false,
      rewardsDistributed: false,
      wild,
      contributions: {},
      attackFeed: [],
      chat: [],
    };

    await setWorldBoss(state);
    res.json({ state });
  } catch (err) {
    log.error({ err }, "Admin world-boss spawn error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 월드보스 즉시 종료 — active면 active=false로 내린다(처치와 무관, 보상 배분도 하지 않음).
adminRoutes.post("/world-boss/end", async (_req, res) => {
  try {
    await mutateWorldBoss((ws) => {
      ws.active = false;
      return ws;
    });
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Admin world-boss end error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 월드보스 현재 상태(관리자 조회) — 전체 상태 그대로.
adminRoutes.get("/world-boss", async (_req, res) => {
  try {
    const state = await getWorldBoss();
    res.json({ state });
  } catch (err) {
    log.error({ err }, "Admin world-boss get error");
    res.status(500).json({ error: "서버 오류" });
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
          const moveResult = applyLearnedMoves(poke, result.newMoves);
          if (moveResult.pending.length > 0) {
            queuePendingMoveLearns(user, poke.uid, moveResult.pending);
          }
          const newStats = calculateStatsForLevel(poke.species, result.newLevel, poke.nature, poke.variantId, poke.ivs, poke.evs);
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
    });
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

    await withLock(`user:${userId}`, async () => {
      const user = await getUser(userId);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      user.points += amount;
      await saveUser(user, "admin-adjust");
      res.json({ ok: true, points: user.points });
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});

// 아이템 직접 지급
adminRoutes.post("/test/give-item", async (req, res) => {
  try {
    const { userId, item, quantity } = req.body;
    if (!userId || !item) return res.status(400).json({ error: "userId, item 필요" });

    await withLock(`user:${userId}`, async () => {
      const user = await getUser(userId);
      if (!user) return res.status(404).json({ error: "유저 없음" });

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
    if (!userId || !species) return res.status(400).json({ error: "userId, species 필요" });

    await withLock(`user:${userId}`, async () => {
      const user = await getUser(userId);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      const pokemon = createPokemon(species, level || 5);
      if (typeof hasGigantamaxFactor === "boolean") {
        pokemon.hasGigantamaxFactor = hasGigantamaxFactor;
      }
      if (user.party.length < 6) {
        user.pokemon.push(pokemon);
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
    log.error({ err }, "Admin route error");
    res.status(500).json({ error: "서버 오류" });
  }
});

// 전투 상태 초기화
adminRoutes.post("/test/clear-battle", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId 필요" });

    await withLock(`user:${userId}`, async () => {
      const user = await getUser(userId);
      if (!user) return res.status(404).json({ error: "유저 없음" });

      user.battleState = null;
      await saveUser(user);
      res.json({ ok: true });
    });
  } catch {
    res.status(500).json({ error: "서버 오류" });
  }
});
