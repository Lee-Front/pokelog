/**
 * PvP 보상/에스크로/ELO — Phase 2.
 *
 * 설계 핵심(원자성·멱등):
 *  - 매치 파일이 에스크로 자산의 단일 진실원본이다. stake 확정 시 유저 데이터에서 자산을
 *    "빼서"(debit) 매치의 escrow로 옮긴다(locked=true). 매치 동안 그 자산은 유저 데이터에
 *    존재하지 않으므로 사용/판매/트레이드가 구조적으로 불가능하다.
 *  - 정산(settle)은 매치 락 안에서 stakes.settled 플래그로 멱등을 보장한다. 한 번 정산되면
 *    재호출해도 아무 일도 일어나지 않는다(이중지급·복제 방지).
 *  - 유저 파일에는 per-user 락이 없으므로(폴링 stale-save 클래스 #19), 에스크로 락/정산의
 *    유저 데이터 변경은 pvp-store.withLock(`user:${id}`)로 직렬화한다. 같은 유저의 두 매치가
 *    동시에 정산되어도 read-modify-write가 경합하지 않는다.
 *
 * 결과별 정산:
 *  - decided/forfeit + 승자 존재: points=패자→승자 스틸. wager=양측 에스크로 전부 승자에게.
 *  - decided 무승부(동시전멸): points=이동 없음. wager=에스크로 원소유자 반환.
 *  - voided/expired/declined: 이동 없음. wager 에스크로는 원소유자 반환.
 */
import type {
  OwnedPokemon, PvpDemand, PvpEscrow, PvpMatch, PvpResult, PvpStakeSpec, UserData,
} from "../../../../shared/types.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getMatch, saveMatch, withLock } from "../storage/pvp-store.js";
import { getStats, updateStats } from "../storage/pvp-stats-store.js";
import { getConfig } from "../storage/config-store.js";
import { incrementItem } from "./inventory-utils.js";
import { GameRuleError } from "./game-errors.js";

// --- ELO -----------------------------------------------------------------------

/** A가 B에게 이길 기대 확률(표준 ELO 로지스틱). */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * 한 경기 후 새 레이팅. score=1(승)/0.5(무)/0(패). 정수로 반올림.
 * 결정적(난수 없음) — 테스트에서 그대로 검증.
 */
export function nextRating(rating: number, opponentRating: number, score: number, k: number): number {
  return Math.round(rating + k * (score - expectedScore(rating, opponentRating)));
}

// --- 에스크로 클론 도우미 -------------------------------------------------------

function clonePokemon(p: OwnedPokemon): OwnedPokemon {
  return {
    ...p,
    variantId: p.variantId ?? null,
    stats: { ...p.stats },
    moves: p.moves.map((m) => ({ ...m })),
    moveUsageCounts: { ...(p.moveUsageCounts ?? {}) },
  };
}

function emptyEscrow(): PvpEscrow {
  return { locked: true, points: 0, items: {}, pokemon: [] };
}

// --- stake 명세 정규화·검증 ----------------------------------------------------

/** 임의 입력을 PvpStakeSpec으로 정규화(음수·비정수 제거). */
export function normalizeStakeSpec(input: unknown): PvpStakeSpec {
  const obj = (input ?? {}) as Record<string, unknown>;
  const points = Number.isFinite(obj.points) ? Math.max(0, Math.floor(obj.points as number)) : 0;
  const items: Record<string, number> = {};
  if (obj.items && typeof obj.items === "object") {
    for (const [id, qty] of Object.entries(obj.items as Record<string, unknown>)) {
      const n = Number.isFinite(qty) ? Math.floor(qty as number) : 0;
      if (n > 0) items[id] = n;
    }
  }
  const pokemonUids = Array.isArray(obj.pokemonUids)
    ? [...new Set(obj.pokemonUids.map(String))]
    : [];
  return { points, items, pokemonUids };
}

/** stake가 비었는지(거는 게 아무것도 없음). */
export function isEmptyStake(spec: PvpStakeSpec): boolean {
  return spec.points <= 0
    && Object.keys(spec.items).length === 0
    && spec.pokemonUids.length === 0;
}

/** 임의 입력을 PvpDemand로 정규화(음수·비정수 제거). pokemonUids는 상대의 특정 포켓몬 uid 목록. */
export function normalizeDemand(input: unknown): PvpDemand {
  const obj = (input ?? {}) as Record<string, unknown>;
  const points = Number.isFinite(obj.points) ? Math.max(0, Math.floor(obj.points as number)) : 0;
  const items: Record<string, number> = {};
  if (obj.items && typeof obj.items === "object") {
    for (const [id, qty] of Object.entries(obj.items as Record<string, unknown>)) {
      const n = Number.isFinite(qty) ? Math.floor(qty as number) : 0;
      if (n > 0) items[id] = n;
    }
  }
  const pokemonUids = Array.isArray(obj.pokemonUids)
    ? [...new Set(obj.pokemonUids.map(String))]
    : [];
  return { points, items, pokemonUids };
}

/** demand가 비었는지(요구하는 게 아무것도 없음 — 친선). */
export function isEmptyDemand(demand: PvpDemand): boolean {
  return demand.points <= 0
    && Object.keys(demand.items).length === 0
    && demand.pokemonUids.length === 0;
}

/**
 * demand를 그대로 충족하는 opponent의 PvpStakeSpec을 만든다. challenger가 도전 생성 시 상대의
 * 특정 포켓몬(uid)을 직접 골라 demand에 박아두므로, 수락 시 opponent는 고르지 않는다 — demand의
 * pokemonUids를 그대로 stake로 쓴다. 그 포켓몬이 여전히 상대 소유인지·안전규칙 위반 여부는
 * lockStake가 락 직전에 재검증한다(원자성). points/items도 demand 그대로(보유 검증·차감은 lockStake).
 */
export function buildOpponentStakeFromDemand(demand: PvpDemand): PvpStakeSpec {
  return {
    points: demand.points,
    items: { ...demand.items },
    pokemonUids: [...demand.pokemonUids],
  };
}

/**
 * 유저가 매치 전투에 내보낸 팀(스냅샷 uid 집합)을 stake로 걸 수 없게 막기 위한 도우미.
 * 전투 팀 uid와 겹치는 포켓몬은 stake 대상에서 거부한다.
 */
function battleTeamUids(match: PvpMatch, sideKey: "challenger" | "opponent"): Set<string> {
  return new Set(match[sideKey].team.map((c) => c.uid));
}

/** 포켓몬을 유저 데이터(party/pokemon 또는 storage)에서 찾는다. */
function locatePokemon(user: UserData, uid: string): { pokemon: OwnedPokemon; container: "party" | "storage" } | null {
  const inParty = user.party.includes(uid);
  const owned = user.pokemon.find((p) => p.uid === uid);
  if (inParty && owned) return { pokemon: owned, container: "party" };
  const stored = user.storage.find((p) => p.uid === uid);
  if (stored) return { pokemon: stored, container: "storage" };
  if (owned) return { pokemon: owned, container: "party" }; // pokemon에 있으나 party 리스트 누락 방어
  return null;
}

// --- 에스크로 락(자산 debit) ---------------------------------------------------

/**
 * stake를 확정해 유저 데이터에서 자산을 빼고 에스크로로 옮긴다. 소유권/잔액/안전규칙을 검증하고
 * 위반 시 GameRuleError로 거부(아무것도 빼지 않음 — 검증을 먼저 끝낸 뒤에만 변경).
 *
 * 안전규칙:
 *  - 포인트: 보유 이내.
 *  - 아이템: 보유 수량 이내.
 *  - 포켓몬: 실제 소유 + 현재 매치 전투 팀과 겹치지 않음 + stake 후에도 최소 1마리(party+storage 잔여)
 *    보유. 전투 중인 포켓몬(battleState)도 거부.
 *
 * pvp-store.withLock(`user:${id}`) 안에서 유저를 다시 읽어(최신값) 변경·저장한다.
 * 반환: 락된 PvpEscrow(매치에 기록할 스냅샷).
 */
export async function lockStake(
  match: PvpMatch,
  sideKey: "challenger" | "opponent",
  spec: PvpStakeSpec,
): Promise<PvpEscrow> {
  const userId = match[sideKey].userId;
  const teamUids = battleTeamUids(match, sideKey);

  return withLock(`user:${userId}`, async () => {
    const user = await getUser(userId);
    if (!user) throw new GameRuleError("사용자를 찾을 수 없습니다.", 404);

    // --- 검증(변경 전에 전부 통과해야 한다) ---
    if (spec.points > 0 && user.points < spec.points) {
      throw new GameRuleError("거는 포인트가 보유 포인트를 초과합니다.");
    }
    for (const [item, qty] of Object.entries(spec.items)) {
      if ((user.inventory[item] ?? 0) < qty) {
        throw new GameRuleError(`아이템 '${item}' 보유 수량이 부족합니다.`);
      }
    }
    const locatedMons: Array<{ pokemon: OwnedPokemon; container: "party" | "storage" }> = [];
    for (const uid of spec.pokemonUids) {
      if (teamUids.has(uid)) {
        throw new GameRuleError("전투에 내보낸 포켓몬은 stake로 걸 수 없습니다.");
      }
      if (user.battleState?.myPokemonUid === uid) {
        throw new GameRuleError("전투 중인 포켓몬은 stake로 걸 수 없습니다.");
      }
      const found = locatePokemon(user, uid);
      if (!found) throw new GameRuleError("보유하지 않은 포켓몬은 stake로 걸 수 없습니다.");
      locatedMons.push(found);
    }
    // 잔여 포켓몬 안전규칙: stake로 빠지는 포켓몬을 빼고도 최소 1마리는 남아야 한다.
    const totalOwned = user.pokemon.length + user.storage.length;
    if (totalOwned - spec.pokemonUids.length < 1) {
      throw new GameRuleError("모든 포켓몬을 걸 수는 없습니다. 최소 1마리는 남겨야 합니다.");
    }

    // --- debit: 유저 데이터에서 자산 제거 → 에스크로 ---
    const escrow = emptyEscrow();
    escrow.points = spec.points;
    user.points -= spec.points;

    for (const [item, qty] of Object.entries(spec.items)) {
      user.inventory[item] = (user.inventory[item] ?? 0) - qty;
      if (user.inventory[item] <= 0) delete user.inventory[item];
      escrow.items[item] = qty;
    }

    for (const uid of spec.pokemonUids) {
      const snapshot = clonePokemon(locatePokemon(user, uid)!.pokemon);
      user.pokemon = user.pokemon.filter((p) => p.uid !== uid);
      user.party = user.party.filter((u) => u !== uid);
      user.storage = user.storage.filter((p) => p.uid !== uid);
      escrow.pokemon.push(snapshot);
    }

    // 의도된 차감 — 잔액 회귀 경고를 끈다(에스크로로의 이동이지 유실이 아님).
    await saveUser(user, "pvp-escrow");
    return escrow;
  });
}

// --- 에스크로 지급/반환 --------------------------------------------------------

/** 에스크로 자산을 한 유저에게 입금(승자 지급 또는 원소유자 반환). 포켓몬은 storage로 들어간다. */
async function creditEscrow(userId: string, escrow: PvpEscrow): Promise<void> {
  await withLock(`user:${userId}`, async () => {
    const user = await getUser(userId);
    if (!user) {
      // 수령자가 사라졌으면 입금할 곳이 없다 — 조용히 스킵(자산은 매치에 보존된 채 남는다).
      return;
    }
    user.points += escrow.points;
    for (const [item, qty] of Object.entries(escrow.items)) {
      incrementItem(user.inventory, item, qty);
    }
    for (const p of escrow.pokemon) {
      // 보관함으로 입고(파티는 직접 넣지 않음 — 슬롯/파티 규칙 회피, 유저가 정리).
      user.storage.push(clonePokemon(p));
      if (!user.pokedex.includes(p.species)) user.pokedex.push(p.species);
    }
    // 입금은 잔액 증가이므로 회귀 경고와 무관하지만, 명시적으로 reason을 남긴다.
    await saveUser(user, "pvp-payout");
  });
}

// --- ELO/전적 갱신 -------------------------------------------------------------

/**
 * decided/forfeit 결과에 양측 전적·ELO를 갱신한다. 무승부면 winner/loser가 null이고
 * 양측 nickname은 매치 side에서 가져온다. 멱등 호출 가드는 상위(settleMatch)에서 처리.
 */
async function applyEloAndRecord(match: PvpMatch, result: PvpResult): Promise<void> {
  const { elo } = (await getConfig()).pvp;
  const c = match.challenger;
  const o = match.opponent;

  // 양측 현재 레이팅을 먼저 읽어 동시 갱신의 기준값으로 쓴다(서로의 갱신 전 값으로 계산).
  const [cStats, oStats] = await Promise.all([
    getStats(c.userId),
    getStats(o.userId),
  ]);
  const cRating = cStats?.rating ?? elo.start;
  const oRating = oStats?.rating ?? elo.start;

  // score: 무승부 0.5, 승 1, 패 0.
  let cScore: number;
  let oScore: number;
  if (!result.winnerUserId) {
    cScore = 0.5; oScore = 0.5;
  } else if (result.winnerUserId === c.userId) {
    cScore = 1; oScore = 0;
  } else {
    cScore = 0; oScore = 1;
  }

  await Promise.all([
    updateStats(c.userId, c.nickname, elo.start, (s) => {
      s.rating = nextRating(cRating, oRating, cScore, elo.k);
      if (cScore === 1) s.wins += 1;
      else if (cScore === 0) s.losses += 1;
      else s.draws += 1;
    }),
    updateStats(o.userId, o.nickname, elo.start, (s) => {
      s.rating = nextRating(oRating, cRating, oScore, elo.k);
      if (oScore === 1) s.wins += 1;
      else if (oScore === 0) s.losses += 1;
      else s.draws += 1;
    }),
  ]);
}

// --- 정산(단일 진입점, 멱등) ---------------------------------------------------

/**
 * 매치 종료 후 정산한다(단일 에스크로 경로 — 별도 보상모드 없음). finishMatch가 매치를
 * finished로 만든 "뒤", 매치 저장이 커밋된 다음 호출한다. 매치 락 안에서 settled 플래그를
 * 멱등 가드로 쓴다(이미 settled면 즉시 반환 → 이중정산 방지).
 *
 * 빈 stake(친선)면 에스크로가 0/빈 채라 입금·반환이 자연히 no-op이다. 처분 규칙:
 *  - decided/forfeit + 승자 존재 → 승자독식(양측 에스크로 전부 승자에게).
 *  - 무승부(승자 null)·expired·declined·voided → 원소유자에게 정확히 반환.
 * ELO/전적은 decided/forfeit에만 갱신(무승부 포함).
 *
 * 유저 데이터 변경(에스크로 입금)은 각 user 락에서, 매치 settled 전이는 매치 락에서 수행되며
 * 입금과 settled 플래그를 같은 매치 락 트랜잭션에서 처리해 재진입/이중지급을 막는다.
 */
export async function settleMatch(matchId: string): Promise<void> {
  await withLock(`match:${matchId}`, async () => {
    const match = await getMatch(matchId);
    if (!match || !match.result) return;
    if (match.stakes.settled) return; // 멱등 가드

    const result = match.result;
    const cEscrow = match.stakes.challengerEscrow ?? null;
    const oEscrow = match.stakes.opponentEscrow ?? null;
    const cId = match.challenger.userId;
    const oId = match.opponent.userId;

    if ((result.kind === "decided" || result.kind === "forfeit") && result.winnerUserId) {
      // 승자독식: 양측 에스크로 전부 승자에게(빈 에스크로면 no-op).
      const winnerId = result.winnerUserId;
      if (cEscrow) await creditEscrow(winnerId, cEscrow);
      if (oEscrow) await creditEscrow(winnerId, oEscrow);
    } else {
      // 무승부·expired·declined·voided: 원소유자에게 정확히 반환.
      if (cEscrow) await creditEscrow(cId, cEscrow);
      if (oEscrow) await creditEscrow(oId, oEscrow);
    }

    if (result.kind === "decided" || result.kind === "forfeit") {
      await applyEloAndRecord(match, result);
    }

    // 에스크로 소진 표시(locked=false) + settled로 멱등 가드.
    if (match.stakes.challengerEscrow) match.stakes.challengerEscrow.locked = false;
    if (match.stakes.opponentEscrow) match.stakes.opponentEscrow.locked = false;
    match.stakes.settled = true;
    await saveMatch(match);
  });
}
