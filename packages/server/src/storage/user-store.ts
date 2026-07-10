import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { GitIntegration, Integration, OwnedPokemon, UserData } from "../../../../shared/types.js";
import { getDataDir } from "../paths.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { getExpForLevelInGroup } from "../game/growth.js";
import { seededIvs } from "../game/ivs.js";
import { emptyEvs } from "../game/evs.js";
import { calculateStatsForLevel } from "../game/pokemon-stats.js";
import { normalizeDamageTakenTotal } from "../game/battle-progress.js";
import { resolvePokemonGender, seededGenderRoll } from "../game/pokemon-gender.js";
import { normalizeMoveUsageCounts } from "../game/move-usage.js";
import {
  ensureUserIndex,
  removeFromUserIndex,
  updateUserIndex,
  type UserIndexEntry,
} from "./user-index.js";
import { childLogger } from "../logger.js";

const log = childLogger("user-store");

/** Name of the identity index file; excluded from full-user iteration. */
const USER_INDEX_FILENAME = "_index.json";

function userPath(userId: string): string {
  return path.join(getDataDir(), "users", `${userId}.json`);
}

export async function getUser(userId: string): Promise<UserData | null> {
  const user = await readJson<UserData>(userPath(userId));
  return user ? normalizeUserData(user) : null;
}

/**
 * Persist a user. `reason` labels the call site so intentional balance drops
 * (shop purchases, admin adjustments) can opt out of the regression warning
 * below; omit it for the polling/reward paths where a drop is never expected.
 */
export async function saveUser(userData: UserData, reason?: string): Promise<void> {
  const normalized = normalizeUserData(userData);
  await warnOnBalanceRegression(normalized, reason);
  await writeJson(userPath(normalized.account.id), normalized);
  // The user file is the source of truth; the index is a rebuildable cache.
  // If the index update fails we keep the successful save but surface the
  // drift, since lookups (email/repo) may be stale until the index is rebuilt.
  try {
    await updateUserIndex(normalized);
  } catch (err) {
    log.warn(
      { err, userId: normalized.account.id },
      "User saved but identity index update failed; index may be stale",
    );
  }
}

/** Call sites that legitimately reduce points/exp; skip the regression warning. */
const INTENTIONAL_DEBIT_REASONS = new Set(["shop-purchase", "admin-adjust", "admin-recompute"]);

/**
 * Diagnostic guard for the stale-save class of bug (#19): a save that lowers a
 * user's points or totalExp below what is already on disk almost always means a
 * stale in-memory object is overwriting a fresh reward. Read the current file
 * and emit a WARNING (with a stack) on any regression so it surfaces in logs
 * instead of silently zeroing balances. Intentional debits pass a `reason`.
 */
async function warnOnBalanceRegression(next: UserData, reason?: string): Promise<void> {
  if (reason && INTENTIONAL_DEBIT_REASONS.has(reason)) return;
  const existing = await readJson<UserData>(userPath(next.account.id));
  if (!existing) return;

  for (const field of ["points", "totalExp"] as const) {
    const before = existing[field];
    const after = next[field];
    if (typeof before === "number" && typeof after === "number" && after < before) {
      log.warn(
        {
          userId: next.account.id,
          field,
          before,
          after,
          reason,
          stack: new Error("balance regression").stack,
        },
        `saveUser regression: ${field} ${before} -> ${after} (possible stale-save overwrite)`,
      );
    }
  }
}

/** Delete a user's file and drop it from the identity index. */
export async function deleteUser(userId: string): Promise<void> {
  try {
    await fs.unlink(userPath(userId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await removeFromUserIndex(userId);
}

/**
 * Loads every user file into memory. This does not scale beyond a few hundred
 * users, so it is reserved for whole-population operations only (admin tooling,
 * rankings, polling sweeps). For identity lookups use the index-backed helpers
 * (findUserByEmail, searchUsersByIdentity, getUsersForRepoCommit,
 * isRepoEmailTaken); for single-user lookups by id use getUser(id).
 */
export async function getAllUsers(): Promise<UserData[]> {
  const usersDir = path.join(getDataDir(), "users");
  try {
    const files = await fs.readdir(usersDir);
    const users: UserData[] = [];
    for (const file of files) {
      if (file === USER_INDEX_FILENAME) continue;
      if (file.endsWith(".json")) {
        const user = await readJson<UserData>(path.join(usersDir, file));
        if (user) users.push(normalizeUserData(user));
      }
    }
    return users;
  } catch {
    return [];
  }
}

export async function findUserByEmail(email: string): Promise<UserData | null> {
  const index = await ensureUserIndex(getUser);
  for (const [userId, entry] of Object.entries(index.users)) {
    if (entry.emails.includes(email)) {
      const user = await getUser(userId);
      if (user) return user;
    }
  }
  return null;
}

export async function isEmailTaken(email: string): Promise<boolean> {
  const index = await ensureUserIndex(getUser);
  return Object.values(index.users).some((entry) => entry.emails.includes(email));
}

export async function searchUsersByIdentity(
  query: string,
  options: {
    excludeUserId?: string;
    limit?: number;
  } = {},
): Promise<Array<{ id: string; nickname: string }>> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const index = await ensureUserIndex(getUser);
  const ranked = Object.entries(index.users)
    .filter(([userId]) => userId !== options.excludeUserId)
    .map(([userId, entry]) => {
      const normalizedId = entry.id;
      const normalizedNickname = entry.nickname;

      let score = -1;
      if (normalizedId === normalizedQuery) score = 100;
      else if (normalizedNickname === normalizedQuery) score = 95;
      else if (normalizedId.startsWith(normalizedQuery)) score = 80;
      else if (normalizedNickname.startsWith(normalizedQuery)) score = 75;
      else if (normalizedId.includes(normalizedQuery)) score = 50;
      else if (normalizedNickname.includes(normalizedQuery)) score = 45;

      return {
        id: userId,
        nickname: entry.nicknameDisplay,
        score,
      };
    })
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => (
      right.score - left.score
      || left.id.localeCompare(right.id)
    ));

  return ranked
    .slice(0, Math.max(1, options.limit ?? 10))
    .map(({ id, nickname }) => ({ id, nickname }));
}

function normalizeIntegration(integration: Integration): Integration {
  return {
    ...integration,
    failCount: integration.failCount ?? 0,
  };
}

export function normalizeOwnedPokemon(pokemon: OwnedPokemon): OwnedPokemon {
  const species = getSpeciesByName(pokemon.species);
  const gender = pokemon.gender ?? resolvePokemonGender(
    species?.genderRate,
    seededGenderRoll(`${pokemon.uid}:${pokemon.species}`),
  );

  // 개체값(IV) 마이그레이션 — 과거 개체는 IV가 없다(=0 취급). 없으면 uid 기반 결정적 IV를
  // 부여하고 그 IV로 스탯을 재계산한다(본가식). 이미 있으면 그대로(스탯도 보존).
  let ivs = pokemon.ivs;
  // 노력치(EV) 마이그레이션 — 과거 개체는 EV가 없다(=0 취급). 0 EV는 스탯에 영향이
  // 없어 별도 재계산이 필요 없지만, 시그니처 일관성을 위해 재계산에도 함께 넘긴다.
  const evs = pokemon.evs ?? emptyEvs();
  let { maxHp, stats, hp } = pokemon;
  if (!ivs) {
    ivs = seededIvs(`${pokemon.uid}:${pokemon.species}`);
    try {
      const recalced = calculateStatsForLevel(
        pokemon.species,
        pokemon.level,
        pokemon.nature ?? "hardy",
        pokemon.variantId,
        ivs,
        evs,
      );
      maxHp = recalced.maxHp;
      stats = recalced.stats;
      hp = Math.min(pokemon.hp, maxHp);
    } catch {
      /* 종 데이터 없으면 기존 스탯 유지 */
    }
  }

  return {
    ...pokemon,
    variantId: pokemon.variantId ?? null,
    gender,
    ivs,
    evs,
    maxHp,
    stats,
    hp,
    // 레벨에 맞는 최소 누적 경험치 보정(위로만 클램프) — 과거 exp:0 개체나, 성장곡선이
    // 종별(expGroup)로 바뀌며 저장 exp가 현재 레벨의 새 임계치 아래로 내려간 개체를 끌어올린다.
    // 임계치 아래로 떨어지는 일은 곡선 변경 때만 생기므로 위로만 올린다(초과분은 max로 보존 →
    // 정상 레벨업 루프가 처리, 스푸리어스 강등/음수 exp바 없음).
    exp: Math.max(pokemon.exp ?? 0, getExpForLevelInGroup(species?.expGroup ?? "medium", pokemon.level)),
    friendship: pokemon.friendship ?? 70,
    heldItem: pokemon.heldItem ?? null,
    abilityId: pokemon.abilityId ?? null,
    moveUsageCounts: normalizeMoveUsageCounts(pokemon.moveUsageCounts),
    damageTakenTotal: normalizeDamageTakenTotal(pokemon.damageTakenTotal),
    nature: pokemon.nature ?? "hardy",
    isShiny: pokemon.isShiny ?? false,
    statusCondition: pokemon.statusCondition ?? null,
  };
}

/**
 * Roster slice of {@link UserData}: the three fields whose mutual invariant
 * {@link reconcileRoster} enforces. Each pokemon `uid` must appear at most once
 * across `pokemon[]` ∪ `storage[]`, and `party` may only reference uids present
 * in `pokemon[]` (≤ 6, no duplicates).
 */
export interface RosterSlice {
  party: string[];
  pokemon: OwnedPokemon[];
  storage: OwnedPokemon[];
}

/** Maximum party size; party uids are capped here after reconciliation. */
const MAX_PARTY_SIZE = 6;

/**
 * Returns true when `next` is strictly more progressed than `current` and so
 * should replace it as the kept copy of a duplicated uid. Compares `level`
 * first, then `exp`; equal-or-lower returns false so the first-encountered copy
 * wins ties (callers iterate pokemon[] before storage[], preserving order).
 */
function isMoreProgressed(next: OwnedPokemon, current: OwnedPokemon): boolean {
  if (next.level !== current.level) return next.level > current.level;
  if (next.exp !== current.exp) return next.exp > current.exp;
  return false;
}

/**
 * Enforces the roster invariant (#data-integrity): every pokemon uid appears at
 * most once across `pokemon[]` ∪ `storage[]`, and `party` references only uids
 * present in `pokemon[]` (deduped, capped at six).
 *
 * Production user files drifted into impossible states — the same uid in both
 * `pokemon[]` and `storage[]` (sometimes diverged by evolution/leveling), or
 * twice within one array — from unsynchronized read-modify-write. Running this
 * at the single normalization chokepoint means the impossible state can neither
 * be read nor persisted, and the same pass repairs existing files.
 *
 * Pure: no I/O. Deterministic dedupe keeps the most-progressed copy
 * ({@link isMoreProgressed}); each kept uid lands in `pokemon[]` if the party
 * references it, otherwise in the array its kept copy came from. Order is the
 * stable first-appearance order of original `pokemon[]` then `storage[]`.
 */
export function reconcileRoster(roster: RosterSlice): RosterSlice {
  const pokemon = Array.isArray(roster.pokemon) ? roster.pokemon : [];
  const storage = Array.isArray(roster.storage) ? roster.storage : [];
  const party = Array.isArray(roster.party) ? roster.party : [];
  const partySet = new Set(party);

  type Origin = "pokemon" | "storage";
  interface Kept {
    copy: OwnedPokemon;
    origin: Origin;
    /** First-appearance index across [pokemon..., storage...], for stable order. */
    order: number;
  }

  // Group by uid, keeping the single most-progressed copy and remembering where
  // it (the chosen copy) came from plus its first-appearance position.
  const kept = new Map<string, Kept>();
  let order = 0;
  const consider = (entry: OwnedPokemon, origin: Origin): void => {
    const seq = order++;
    const existing = kept.get(entry.uid);
    if (!existing) {
      kept.set(entry.uid, { copy: entry, origin, order: seq });
      return;
    }
    // Keep earliest first-appearance order; replace the copy only if strictly
    // more progressed (ties keep the first encountered, i.e. existing).
    if (isMoreProgressed(entry, existing.copy)) {
      existing.copy = entry;
      existing.origin = origin;
    }
  };
  for (const entry of pokemon) consider(entry, "pokemon");
  for (const entry of storage) consider(entry, "storage");

  // Destination: party members must live in pokemon[]; otherwise honor origin.
  // Emit in stable first-appearance order.
  const ordered = [...kept.values()].sort((a, b) => a.order - b.order);
  const nextPokemon: OwnedPokemon[] = [];
  const nextStorage: OwnedPokemon[] = [];
  for (const { copy, origin } of ordered) {
    const dest: Origin = partySet.has(copy.uid) ? "pokemon" : "storage";
    if (dest === "pokemon") nextPokemon.push(copy);
    else nextStorage.push(copy);
  }

  // Party may only reference uids now in pokemon[]; dedupe (first wins), cap.
  const inPokemon = new Set(nextPokemon.map((p) => p.uid));
  const seenParty = new Set<string>();
  const nextParty: string[] = [];
  for (const uid of party) {
    if (!inPokemon.has(uid) || seenParty.has(uid)) continue;
    seenParty.add(uid);
    nextParty.push(uid);
    if (nextParty.length >= MAX_PARTY_SIZE) break;
  }

  return { party: nextParty, pokemon: nextPokemon, storage: nextStorage };
}

// 인벤토리 아이템 키 별칭 — 과거 드랍/배틀상점이 하이픈 id(poke-ball 등)로 지급한 볼·포션을
// 전투 가방·catch/heal이 인식하는 정식 키(무하이픈, config.shop.items 체계)로 병합한다.
const INVENTORY_KEY_ALIASES: Record<string, string> = {
  "poke-ball": "pokeball",
  "great-ball": "greatball",
  "ultra-ball": "ultraball",
  "safari-ball": "safariball",
  "master-ball": "masterball",
  "super-potion": "superPotion",
  "hyper-potion": "hyperPotion",
};

function normalizeInventory(inv: unknown): Record<string, number> {
  const src = (inv && typeof inv === "object" ? inv : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(src)) {
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    const canonical = INVENTORY_KEY_ALIASES[key] ?? key;
    out[canonical] = (out[canonical] ?? 0) + n;
  }
  return out;
}

/**
 * 가리키는 포켓몬(pokemonUid)이 살아있는(liveUids에 존재하는) 대기 결정만 남긴다.
 * 과거 로스터 손상으로 개체는 사라졌는데 pendingEvolutions/pendingMoveLearns만 남으면
 * resolve가 404("Pokemon not found.")를 내고, 한 번에 하나씩 처리하는 UI에서는 그 한 건이
 * 큐 전체를 막는다 — normalize 단계에서 댕글링을 걷어내 자가 치유한다.
 */
export function dropDanglingPending<T extends { pokemonUid: string }>(
  entries: T[],
  liveUids: ReadonlySet<string>,
): T[] {
  return entries.filter((entry) => liveUids.has(entry.pokemonUid));
}

/**
 * 관심종을 지역별 맵으로 정규화한다. 관심종은 이제 지역키(currentRegion 또는 'default')→종목록
 * 구조다. 마이그레이션 규칙:
 *  - 배열(구버전 전역 목록)이면 `{ [currentRegion]: 그배열 }`로 이관해 데이터를 보존한다.
 *  - 이미 객체(맵)면 각 값이 배열인 항목만 살려 얕게 정규화한다(배열 아닌 값은 버린다).
 *  - 그 외(undefined/원시값 등)면 빈 맵.
 */
function normalizeInterestSpecies(
  raw: unknown,
  currentRegion: string,
): Record<string, string[]> {
  if (Array.isArray(raw)) {
    return { [currentRegion]: raw as string[] };
  }
  if (raw && typeof raw === "object") {
    const out: Record<string, string[]> = {};
    for (const [region, list] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(list)) out[region] = list as string[];
    }
    return out;
  }
  return {};
}

function normalizeUserData(user: UserData): UserData {
  // Map (fill defaults) first so reconcile compares normalized copies and each
  // surviving entry is normalized exactly once; reconcile then drops duplicates.
  const mappedPokemon = Array.isArray(user.pokemon) ? user.pokemon.map(normalizeOwnedPokemon) : [];
  const mappedStorage = Array.isArray(user.storage) ? user.storage.map(normalizeOwnedPokemon) : [];
  const reconciled = reconcileRoster({
    party: Array.isArray(user.party) ? user.party : [],
    pokemon: mappedPokemon,
    storage: mappedStorage,
  });

  if (
    reconciled.pokemon.length !== mappedPokemon.length ||
    reconciled.storage.length !== mappedStorage.length ||
    reconciled.party.length !== (Array.isArray(user.party) ? user.party.length : 0)
  ) {
    log.warn(
      {
        userId: user.account?.id,
        pokemonBefore: mappedPokemon.length,
        pokemonAfter: reconciled.pokemon.length,
        storageBefore: mappedStorage.length,
        storageAfter: reconciled.storage.length,
        partyBefore: Array.isArray(user.party) ? user.party.length : 0,
        partyAfter: reconciled.party.length,
      },
      "reconcileRoster repaired a duplicated/inconsistent roster",
    );
  }

  // 도감 영구 집합 — 단조 증가만(절대 줄지 않음). 보유 종은 반드시 "잡은적(caught=pokedex)"이고
  // (방생-후 파생 버그 방지 + 과거 누락 보강), "만난적(seen)"은 caught를 항상 포함한다.
  const ownedSpecies = [...reconciled.pokemon, ...reconciled.storage].map((p) => p.species);
  const caught = [...new Set([...(Array.isArray(user.pokedex) ? user.pokedex : []), ...ownedSpecies])];
  const seen = [...new Set([...(Array.isArray(user.seenSpecies) ? user.seenSpecies : []), ...caught])];

  // 댕글링 대기 정리 — 가리키는 포켓몬이 더 이상 존재하지 않는(party/pokemon[]/storage[]
  // 어디에도 없는) pendingEvolutions/pendingMoveLearns를 제거한다. 과거 로스터 손상으로
  // 개체는 사라졌는데 대기 결정만 남으면 /moves|/evolutions/resolve가 404("Pokemon not
  // found.")를 내고, 한 번에 하나씩 처리하는 UI에서는 그 한 건이 큐 전체를 막는다.
  const liveUids = new Set([...reconciled.pokemon, ...reconciled.storage].map((p) => p.uid));
  const rawPendingEvolutions = Array.isArray(user.pendingEvolutions) ? user.pendingEvolutions : [];
  const rawPendingMoveLearns = Array.isArray(user.pendingMoveLearns) ? user.pendingMoveLearns : [];
  const pendingEvolutions = dropDanglingPending(rawPendingEvolutions, liveUids);
  const pendingMoveLearns = dropDanglingPending(rawPendingMoveLearns, liveUids);
  if (
    pendingEvolutions.length !== rawPendingEvolutions.length ||
    pendingMoveLearns.length !== rawPendingMoveLearns.length
  ) {
    log.warn(
      {
        userId: user.account?.id,
        droppedEvolutions: rawPendingEvolutions.length - pendingEvolutions.length,
        droppedMoveLearns: rawPendingMoveLearns.length - pendingMoveLearns.length,
      },
      "normalizeUserData dropped dangling pending decisions (target pokemon no longer exists)",
    );
  }

  // 재화 마이그레이션 — 과거 `battleMoney`를 `gameMoney`로 투명 이관한다.
  // gameMoney가 아직 없으면(구 저장본) 옛 battleMoney 값을 옮겨오고, 옛 필드는 버린다.
  // 다음 로드/저장부터는 gameMoney만 남는다.
  const { battleMoney: legacyBattleMoney, ...userWithoutLegacy } = user as UserData & {
    battleMoney?: number;
  };
  const gameMoney = user.gameMoney ?? legacyBattleMoney ?? 0;

  return {
    ...userWithoutLegacy,
    currentRegion: user.currentRegion ?? "default",
    gameMoney,
    inventory: normalizeInventory(user.inventory),
    party: reconciled.party,
    pokemon: reconciled.pokemon,
    storage: reconciled.storage,
    pokedex: caught,
    seenSpecies: seen,
    // 업적 완료 집합 — 구 저장본(필드 없음)은 []로 정규화(후방호환). 1회성 보상 가드로만 쓰인다.
    completedAchievements: Array.isArray(user.completedAchievements) ? user.completedAchievements : [],
    // 주간보스 통산 카운터 — 구 저장본(필드 없음)은 0으로 정규화(업적 조건에서 안전하게 파생).
    bossDefeatTotal: typeof user.bossDefeatTotal === "number" ? user.bossDefeatTotal : 0,
    bossFirstPlaceTotal: typeof user.bossFirstPlaceTotal === "number" ? user.bossFirstPlaceTotal : 0,
    eggs: Array.isArray(user.eggs) ? user.eggs : [],
    pendingEvolutions,
    pendingMoveLearns,
    // 자동 야생 탐색 상태 — 관심종은 지역별 맵(지역키→종목록). 구 저장본이 배열(전역 목록)이면
    // 현재 지역 키 하나로 이관해 데이터를 보존하고, 이미 맵이면 각 값이 배열인지 얕게 정규화한다.
    // 그 외/필드 없음은 {}. storedEncounters는 배열 아니면 [], 토글은 boolean 아니면 false.
    interestSpecies: normalizeInterestSpecies(user.interestSpecies, user.currentRegion ?? "default"),
    storedEncounters: Array.isArray(user.storedEncounters) ? user.storedEncounters : [],
    autoSearchEnabled: typeof user.autoSearchEnabled === "boolean" ? user.autoSearchEnabled : false,
    integrations: Array.isArray(user.integrations)
      ? user.integrations.map(normalizeIntegration)
      : [],
  };
}

export async function getUsersForRepoCommit(
  repoUrl: string,
  authorEmail: string,
): Promise<UserData[]> {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const index = await ensureUserIndex(getUser);

  // Narrow to users whose index records either the repo (any of its
  // integrations, since an empty email list is a wildcard match) or a legacy
  // git email match. The full integration filter still runs on each candidate.
  const candidates = candidateUserIds(index.users, (entry) =>
    normalizedRepoUrl in entry.repoEmails || entry.emails.includes(authorEmail),
  );

  const matched: UserData[] = [];
  for (const userId of candidates) {
    const user = await getUser(userId);
    if (!user) continue;
    if (userMatchesRepoCommit(user, normalizedRepoUrl, authorEmail)) {
      matched.push(user);
    }
  }
  return matched;
}

function userMatchesRepoCommit(
  user: UserData,
  normalizedRepoUrl: string,
  authorEmail: string,
): boolean {
  const legacyMatch = user.account.matchings.git?.emails.includes(authorEmail) ?? false;
  for (const integration of user.integrations) {
    if (!isGitIntegration(integration)) continue;
    if (normalizeRepoUrl(integration.config.repoUrl) !== normalizedRepoUrl) continue;
    if (integration.failCount >= 3 || integration.status === "error") continue;
    const emails = integration.emails ?? [];
    if (emails.length === 0 || emails.includes(authorEmail)) return true;
  }
  return legacyMatch;
}

function candidateUserIds(
  users: Record<string, UserIndexEntry>,
  predicate: (entry: UserIndexEntry) => boolean,
): string[] {
  const ids: string[] = [];
  for (const [userId, entry] of Object.entries(users)) {
    if (predicate(entry)) ids.push(userId);
  }
  return ids;
}

export async function isRepoEmailTaken(
  repoUrl: string,
  email: string,
  excludeUserId?: string,
  excludeIntegrationId?: string,
): Promise<boolean> {
  const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
  const index = await ensureUserIndex(getUser);

  // Only users whose index already records this email under this repo can
  // possibly match; load just those and apply the exact exclusion rules.
  const candidates = candidateUserIds(index.users, (entry) =>
    (entry.repoEmails[normalizedRepoUrl] ?? []).includes(email),
  );

  for (const userId of candidates) {
    const user = await getUser(userId);
    if (!user) continue;
    const isExcludedUser = excludeUserId !== undefined && user.account.id === excludeUserId;
    const taken = user.integrations.some((integration) => {
      if (!isGitIntegration(integration)) return false;
      if (isExcludedUser && excludeIntegrationId && integration.id === excludeIntegrationId) {
        return false;
      }
      return (
        normalizeRepoUrl(integration.config.repoUrl) === normalizedRepoUrl &&
        (integration.emails ?? []).includes(email)
      );
    });
    if (taken) return true;
  }
  return false;
}

export function normalizeRepoUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isGitIntegration(integration: Integration): integration is GitIntegration {
  return integration.provider === "git" || integration.provider === "github" || integration.provider === "gitlab";
}
