/**
 * 유저간 PvP 매치 라이프사이클 — Phase 1(친선전) + Phase 2(보상/베팅/랭킹).
 *
 * 매칭: 지정 도전(challenge) + 자동 대기열(queue). 매치 상태머신
 *  pending → active → finished. 라운드는 양측 행동이 모두 제출되면 해결된다.
 *
 * 전투 해결은 pvp-engine에 위임하고, 여기서는 매치 상태(스냅샷·교체·승패·만료)와
 * 저장소 동시성(키별 락)을 다룬다. 보상/에스크로·ELO 정산은 pvp-rewards.settleMatch에
 * 위임하며, 매치를 finished로 만든 직후 그 단일 진입점을 멱등 호출한다(Phase 2).
 */
import crypto from "node:crypto";
import type {
  OwnedPokemon, PvpAction, PvpChatMessage, PvpCombatant, PvpMatch, PvpMode,
  PvpQueueEntry, PvpResultKind, PvpSide, ServerConfig, UserData,
} from "../../../../shared/types.js";
import { getUser } from "../storage/user-store.js";
import { getPartyPokemon, findPokemonByUid } from "./pokemon-state.js";
import { GameRuleError } from "./game-errors.js";
import {
  getMatch, newMatchId, saveMatch, updateMatch, listMatchesForUser,
  updateQueue, withLock,
} from "../storage/pvp-store.js";
import {
  resolveRound, hasAliveReserve, isWipedOut, freshStatStages,
  type EngineSide, type Rng, type ItemLookup, type RoundOutcome, defaultRng,
} from "./pvp-engine.js";
import { saveUser } from "../storage/user-store.js";
import { decrementItem, isBattleUsableItem } from "./inventory-utils.js";
import {
  lockStake, normalizeStakeSpec, normalizeDemand, buildOpponentStakeFromDemand,
  settleMatch,
} from "./pvp-rewards.js";
import { getStats, listRanking } from "../storage/pvp-stats-store.js";
import { getConfig } from "../storage/config-store.js";

/**
 * 매치가 finished면 보상/ELO 정산을 멱등 실행한다. settleMatch가 자체 매치 락에서
 * settled 플래그로 이중정산을 막으므로 여러 번 호출해도 안전하다. 정산 후 최신 매치를 반환.
 */
async function settleIfFinished(match: PvpMatch): Promise<PvpMatch> {
  if (match.status !== "finished") return match;
  if (match.stakes.settled) return match;
  await settleMatch(match.id);
  return (await getMatch(match.id)) ?? match;
}

/** 지정 도전 수락 만료(분). */
const CHALLENGE_EXPIRY_MINUTES = 5;

// --- 스냅샷 빌더 --------------------------------------------------------------

/** OwnedPokemon → 전투용 PvpCombatant 스냅샷(원본과 분리, hp/pp 깊은 복사). */
function toCombatant(p: OwnedPokemon): PvpCombatant {
  return {
    uid: p.uid,
    species: p.species,
    variantId: p.variantId ?? null,
    nickname: p.nickname,
    level: p.level,
    hp: p.hp,
    maxHp: p.maxHp,
    stats: { ...p.stats },
    moves: p.moves.map((m) => ({ ...m })),
    statusCondition: p.statusCondition ?? null,
    sleepTurns: p.sleepTurns,
    volatile: [],
    statStages: freshStatStages(),
  };
}

/**
 * 유저의 전투 파티 스냅샷을 만든다. single 모드면 살아있는 첫 포켓몬 1마리.
 * 살아있는 포켓몬이 없으면 GameRuleError.
 */
function buildTeam(user: UserData, mode: PvpMode, preferredUids?: string[], excludeUids?: string[]): PvpCombatant[] {
  const exclude = new Set(excludeUids ?? []);
  // stake로 거는 포켓몬은 전투 팀에 넣지 않는다 — 같은 개체를 걸면서 동시에 내보낼 수 없으므로
  // (그러면 lockStake의 "전투 팀은 stake 불가" 규칙과 충돌해 수락 자체가 막혔다).
  const party = getPartyPokemon(user).filter((p) => p.hp > 0 && !exclude.has(p.uid));
  if (party.length === 0) {
    throw new GameRuleError("전투에 내보낼 수 있는 포켓몬이 없습니다(전원 기절 또는 거는 포켓몬 제외).");
  }

  let chosen = party;
  if (preferredUids && preferredUids.length > 0) {
    const order = new Map(preferredUids.map((uid, i) => [uid, i]));
    chosen = party
      .filter((p) => order.has(p.uid))
      .sort((a, b) => (order.get(a.uid)! - order.get(b.uid)!));
    if (chosen.length === 0) chosen = party;
  }

  if (mode === "single") chosen = chosen.slice(0, 1);
  return chosen.map(toCombatant);
}

function buildSide(user: UserData, team: PvpCombatant[]): PvpSide {
  return {
    userId: user.account.id,
    nickname: user.account.nickname,
    team,
    activeIndex: 0,
    pendingAction: null,
    forfeited: false,
  };
}

function asEngineSide(side: PvpSide): EngineSide {
  return { userId: side.userId, nickname: side.nickname, team: side.team, activeIndex: side.activeIndex };
}

// --- 지정 도전 ----------------------------------------------------------------

/**
 * A가 B에게 도전 생성 → pending 매치. 합의형 내기: challenger가 자기 stake(challengerStake)를
 * 이 시점에 락하고(빈 stake도 유효), 상대에게 요구할 자산(demand)을 매치에 저장한다. demand의
 * points/items는 수락 시점에 opponent가 충족(차감)하며, 포켓몬은 challenger가 이 시점에 상대의
 * 실제 보유 목록에서 특정 개체(uid)를 직접 골라 요구한다 — 그 uid들이 정말 상대 소유인지 여기서
 * 검증한다(존재·소유). 차감은 하지 않음(수락 시 lockStake). challengerStake 비고 demand 빈 것 =
 * 친선전(에스크로 빈 채 락, 정산 no-op).
 */
export async function createChallenge(input: {
  challengerUserId: string;
  opponentUserId: string;
  mode: PvpMode;
  challengerTeamUids?: string[];
  challengerStake?: unknown;
  demand?: unknown;
}): Promise<PvpMatch> {
  if (input.challengerUserId === input.opponentUserId) {
    throw new GameRuleError("자기 자신에게 도전할 수 없습니다.");
  }
  const [challenger, opponent] = await Promise.all([
    getUser(input.challengerUserId),
    getUser(input.opponentUserId),
  ]);
  if (!challenger || !opponent) {
    throw new GameRuleError("두 사용자가 모두 존재해야 합니다.");
  }

  // challenger stake를 먼저 명세 — 거는 포켓몬은 전투 팀에서 제외해야 하므로.
  const spec = normalizeStakeSpec(input.challengerStake);
  const challengerTeam = buildTeam(challenger, input.mode, input.challengerTeamUids, spec.pokemonUids);
  // 상대 팀은 수락 시점에 스냅샷(수락 전 상태 반영). pending에서는 빈 팀 자리만 둔다.
  const now = new Date();
  const match: PvpMatch = {
    id: newMatchId(),
    status: "pending",
    mode: input.mode,
    origin: "challenge",
    challenger: buildSide(challenger, challengerTeam),
    opponent: buildSide(opponent, []),
    round: 0,
    roundLogs: [],
    chat: [],
    stakes: {},
    result: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_EXPIRY_MINUTES * 60_000).toISOString(),
  };

  // 상대에게 요구할 자산(demand)을 정규화. 포켓몬 demand는 challenger가 상대의 실제 보유 목록에서
  // 고른 특정 uid이므로, 그 uid들이 정말 상대(opponent) 소유인지 이 시점에 검증한다(차감은 수락 시).
  const demand = normalizeDemand(input.demand);
  for (const uid of demand.pokemonUids) {
    if (!findPokemonByUid(opponent, uid)) {
      throw new GameRuleError("상대가 보유하지 않은 포켓몬을 요구할 수 없습니다.");
    }
  }

  // challenger stake를 검증·락(빈 stake면 빈 에스크로가 락된다 — 친선).
  const escrow = await lockStake(match, "challenger", spec);
  match.stakes.challengerStake = spec;
  match.stakes.challengerEscrow = escrow;
  match.stakes.demand = demand;

  await saveMatch(match);
  return match;
}

/**
 * B가 도전 수락 → 상대 팀 스냅샷 후 active 전환. 합의형: challenger가 건 demand를 충족한다.
 * points/items는 demand대로 보유 시 자동 차감, 포켓몬은 challenger가 도전 생성 시 지정한
 * demand.pokemonUids 그대로(opponent는 고르지 않음 — 이미 지정됨). 그 포켓몬이 여전히 상대
 * 소유인지·안전규칙 위반 여부는 lockStake가 락 직전에 재검증한다. 충족분을 opponentEscrow에 락한다.
 * 보유 부족·소유 변동·안전규칙 위반이면 아무것도 차감하지 않고 거부(원자성). demand 빈 것 = 친선.
 */
export async function acceptChallenge(
  userId: string,
  matchId: string,
): Promise<PvpMatch> {
  const opponentUser = await getUser(userId);
  if (!opponentUser) throw new GameRuleError("사용자를 찾을 수 없습니다.");

  const result = await updateMatch(matchId, async (match) => {
    if (match.opponent.userId !== userId) {
      throw new GameRuleError("이 도전을 수락할 권한이 없습니다.");
    }
    if (match.status !== "pending") {
      throw new GameRuleError("대기 중인 도전만 수락할 수 있습니다.");
    }
    if (isExpired(match)) {
      // 만료 수락 → expired 종료(아래 settleIfFinished가 challenger 에스크로를 반환).
      finishMatch(match, "expired", null, null);
      return match;
    }
    // demand 포켓몬은 stake로 빠지므로 전투 팀에서 제외하고 스냅샷한다.
    // (예전엔 팀에 포함돼 lockStake의 "전투 팀은 stake 불가"와 충돌 → 첫 포켓몬 지목 시 수락 불가였다.)
    const demand = normalizeDemand(match.stakes.demand);
    match.opponent.team = buildTeam(opponentUser, match.mode, undefined, demand.pokemonUids);

    // demand의 points/items·포켓몬(challenger가 지정) 그대로 — lockStake가 소유·안전규칙 재검증·락.
    const spec = buildOpponentStakeFromDemand(demand);
    const escrow = await lockStake(match, "opponent", spec);
    match.stakes.opponentEscrow = escrow;

    match.status = "active";
    match.round = 1;
    match.expiresAt = undefined;
    return match;
  });
  if (!result) throw new GameRuleError("도전을 찾을 수 없습니다.", 404);
  if (result.result?.kind === "expired") {
    await settleIfFinished(result);
    throw new GameRuleError("도전이 만료되었습니다.");
  }
  return result;
}

/**
 * 도전 생성용 — 한 유저의 보유 포켓몬 목록(party + storage). challenger가 상대의 특정 포켓몬을
 * 골라 demand하기 위한 가벼운 표현만 노출한다(uid·종·레벨·이로치·닉네임). 정렬: 레벨 내림차순.
 */
export async function listUserPokemonForChallenge(userId: string): Promise<Array<{
  uid: string;
  species: string;
  level: number;
  shiny: boolean;
  nickname: string | null;
}>> {
  const user = await getUser(userId);
  if (!user) throw new GameRuleError("사용자를 찾을 수 없습니다.", 404);
  const all = [...user.pokemon, ...user.storage];
  return all
    .map((p) => ({
      uid: p.uid,
      species: p.species,
      level: p.level,
      shiny: p.isShiny === true,
      nickname: p.nickname ?? null,
    }))
    .sort((a, b) => b.level - a.level);
}

/** B가 도전 거절. */
export async function declineChallenge(userId: string, matchId: string): Promise<PvpMatch> {
  const result = await updateMatch(matchId, (match) => {
    if (match.opponent.userId !== userId) {
      throw new GameRuleError("이 도전을 거절할 권한이 없습니다.");
    }
    if (match.status !== "pending") {
      throw new GameRuleError("대기 중인 도전만 거절할 수 있습니다.");
    }
    finishMatch(match, "declined", null, null);
    return match;
  });
  if (!result) throw new GameRuleError("도전을 찾을 수 없습니다.", 404);
  // declined → challenger 에스크로 반환(wager).
  return settleIfFinished(result);
}

// --- 자동 대기열 --------------------------------------------------------------

/**
 * 대기열 등록 → 같은 mode의 대기자가 있으면 즉시 페어링하여 active 매치 생성·반환.
 * 없으면 큐에 추가하고 매치 없이 반환(matched=false).
 */
export async function enqueue(input: {
  userId: string;
  mode: PvpMode;
  teamUids?: string[];
}): Promise<{ matched: true; match: PvpMatch } | { matched: false }> {
  const user = await getUser(input.userId);
  if (!user) throw new GameRuleError("사용자를 찾을 수 없습니다.");
  // 등록 전에 전투 가능 여부 검증(전원 기절이면 거절).
  buildTeam(user, input.mode, input.teamUids);

  const pairing = await updateQueue<{ partner: PvpQueueEntry | null }>((queue) => {
    // 이미 같은 유저가 큐에 있으면 갱신.
    const without = queue.entries.filter((e) => e.userId !== input.userId);
    // 큐는 stake 협상이 없어 빈 stake(친선)로만 페어링 — 같은 mode끼리 매칭.
    const partner = without.find((e) => e.mode === input.mode);
    if (partner) {
      const remaining = without.filter((e) => e.userId !== partner.userId);
      return { queue: { entries: remaining }, result: { partner } };
    }
    const entry: PvpQueueEntry = {
      userId: input.userId,
      nickname: user.account.nickname,
      mode: input.mode,
      teamUids: input.teamUids ?? [],
      enqueuedAt: new Date().toISOString(),
    };
    return { queue: { entries: [...without, entry] }, result: { partner: null } };
  });

  if (!pairing.partner) return { matched: false };

  // 페어링 성공 — 양쪽 스냅샷을 페어링 시점에 생성.
  const partnerUser = await getUser(pairing.partner.userId);
  if (!partnerUser) {
    // 상대가 사라졌으면 매칭 실패로 간주(요청자는 다시 큐에 넣지 않음 — 재시도는 클라가).
    throw new GameRuleError("상대를 찾을 수 없어 매칭에 실패했습니다. 다시 시도해주세요.");
  }

  const challengerTeam = buildTeam(partnerUser, input.mode, pairing.partner.teamUids);
  const opponentTeam = buildTeam(user, input.mode, input.teamUids);
  const now = new Date();
  const match: PvpMatch = {
    id: newMatchId(),
    status: "active",
    mode: input.mode,
    origin: "queue",
    // 먼저 큐에 있던 쪽을 challenger로.
    challenger: buildSide(partnerUser, challengerTeam),
    opponent: buildSide(user, opponentTeam),
    round: 1,
    roundLogs: [],
    chat: [],
    // 큐 매치는 stake 협상이 없어 항상 빈 stake(친선). 에스크로 없음 → 정산은 ELO만 갱신.
    stakes: {},
    result: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await saveMatch(match);
  return { matched: true, match };
}

/** 대기열 취소. */
export async function dequeue(userId: string): Promise<void> {
  await updateQueue((queue) => ({
    queue: { entries: queue.entries.filter((e) => e.userId !== userId) },
    result: undefined,
  }));
}

// --- 행동 제출 + 라운드 해결 ---------------------------------------------------

/** 매치에서 해당 유저의 side("challenger"/"opponent")를 식별. */
function sideKeyOf(match: PvpMatch, userId: string): "challenger" | "opponent" {
  if (match.challenger.userId === userId) return "challenger";
  if (match.opponent.userId === userId) return "opponent";
  throw new GameRuleError("이 매치의 참가자가 아닙니다.", 403);
}

/**
 * 행동(기술/교체) 제출. 양측 모두 제출되면 라운드를 즉시 해결한다.
 * rng는 테스트 결정성을 위해 주입 가능(기본 Math.random).
 */
export async function submitAction(
  userId: string,
  matchId: string,
  action: PvpAction,
  rng: Rng = defaultRng,
): Promise<PvpMatch> {
  // 아이템 액션은 config(전투가능 분류)·제출자 인벤토리가 있어야 검증되므로 락 밖에서 선조회.
  // 인벤토리 실제 차감은 라운드가 실제로 해결될 때(consumed) user 락 하에서 수행한다.
  const config = await getConfig();
  const items = buildItemLookup(config);
  if (action.kind === "item") {
    const submitter = await getUser(userId);
    if (!submitter) throw new GameRuleError("사용자를 찾을 수 없습니다.");
    validateItemOwnership(submitter, items, action);
  }

  // 라운드가 해결되며 소비된 아이템(차감 대상)을 락 밖으로 꺼내 인벤토리에 반영한다.
  let consumed: { challenger?: { itemId: string }; opponent?: { itemId: string } } = {};
  const result = await updateMatch(matchId, (match) => {
    if (match.status !== "active") {
      throw new GameRuleError("진행 중인 매치가 아닙니다.");
    }
    const key = sideKeyOf(match, userId);
    const side = match[key];
    validateAction(match, side, action);
    side.pendingAction = action;

    // 양측 제출 완료 시 라운드 해결.
    if (match.challenger.pendingAction && match.opponent.pendingAction) {
      consumed = runRound(match, rng, items);
    }
    return match;
  });
  if (!result) throw new GameRuleError("매치를 찾을 수 없습니다.", 404);

  // 실제 사용된 아이템을 양측 유저 인벤토리에서 차감(user 락으로 직렬화). 매치는 친선/내기 무관.
  await consumeItems(result, consumed);

  // 라운드 해결로 승패가 났으면 보상/ELO 정산.
  return settleIfFinished(result);
}

/** config.shop.items 기반 ItemLookup — 전투 사용가능(healAmount) 아이템만 노출. */
function buildItemLookup(config: ServerConfig): ItemLookup {
  return (itemId: string) => {
    const item = config.shop.items[itemId];
    if (!isBattleUsableItem(item)) return undefined;
    return { name: item.name, healAmount: item.healAmount };
  };
}

/** 아이템 액션 제출 시 보유·전투가능 검증(차감은 라운드 해결 시점). */
function validateItemOwnership(user: UserData, items: ItemLookup, action: { itemId: string }): void {
  if (!items(action.itemId)) {
    throw new GameRuleError("전투에서 사용할 수 없는 아이템입니다.");
  }
  if ((user.inventory[action.itemId] ?? 0) <= 0) {
    throw new GameRuleError("보유한 아이템이 없습니다.");
  }
}

/** 라운드 해결로 실제 사용된 아이템을 각 유저 인벤토리에서 1개씩 차감(user 락 직렬화). */
async function consumeItems(
  match: PvpMatch,
  consumed: { challenger?: { itemId: string }; opponent?: { itemId: string } },
): Promise<void> {
  const drains: Array<{ userId: string; itemId: string }> = [];
  if (consumed.challenger) drains.push({ userId: match.challenger.userId, itemId: consumed.challenger.itemId });
  if (consumed.opponent) drains.push({ userId: match.opponent.userId, itemId: consumed.opponent.itemId });
  for (const { userId, itemId } of drains) {
    await withLock(`user:${userId}`, async () => {
      const user = await getUser(userId);
      if (!user) return;
      if ((user.inventory[itemId] ?? 0) <= 0) return; // 이미 없으면 무시(이중차감 방지).
      decrementItem(user.inventory, itemId);
      await saveUser(user, "pvp-item-use");
    });
  }
}

/** 제출 행동 유효성 검증(현재 활성 포켓몬 기준). */
function validateAction(match: PvpMatch, side: PvpSide, action: PvpAction): void {
  if (side.pendingAction) {
    throw new GameRuleError("이미 이번 라운드 행동을 제출했습니다.");
  }
  const activeMon = side.team[side.activeIndex];
  if (action.kind === "move") {
    const move = activeMon.moves.find((m) => m.id === action.moveId);
    if (!move) throw new GameRuleError("배우지 않은 기술입니다.");
    if (move.pp <= 0) throw new GameRuleError("PP가 없는 기술입니다.");
  } else if (action.kind === "switch") {
    if (match.mode === "single") throw new GameRuleError("single 모드에서는 교체할 수 없습니다.");
    const target = side.team[action.teamIndex];
    if (!target) throw new GameRuleError("교체 대상이 올바르지 않습니다.");
    if (action.teamIndex === side.activeIndex) throw new GameRuleError("이미 출전 중인 포켓몬입니다.");
    if (target.hp <= 0) throw new GameRuleError("기절한 포켓몬으로 교체할 수 없습니다.");
  } else if (action.kind === "item") {
    // 전투가능·보유 검증은 submitAction에서 config·인벤토리로 선수행. 여기선 대상(targetUid) 유효성만.
    if (action.targetUid !== undefined && !side.team.some((p) => p.uid === action.targetUid)) {
      throw new GameRuleError("아이템 대상 포켓몬이 올바르지 않습니다.");
    }
  } else {
    throw new GameRuleError("알 수 없는 행동입니다.");
  }
}

/** 라운드 해결: 엔진 호출 → 기절 처리(강제 교체/승패) → 로그 적재 → 다음 라운드 준비.
 *  반환: 라운드에 실제 소비된 아이템(호출부가 인벤토리 차감). */
function runRound(match: PvpMatch, rng: Rng, items: ItemLookup): RoundOutcome["consumed"] {
  const cEngine = asEngineSide(match.challenger);
  const oEngine = asEngineSide(match.opponent);
  const outcome = resolveRound(
    cEngine, match.challenger.pendingAction!,
    oEngine, match.opponent.pendingAction!,
    rng, items,
  );
  // 엔진은 team/activeIndex를 in-place로 바꾼다 — PvpSide에 반영.
  match.challenger.activeIndex = cEngine.activeIndex;
  match.opponent.activeIndex = oEngine.activeIndex;

  const messages = [...outcome.messages];

  // 기절한 쪽이 예비 포켓몬이 있으면 자동으로 다음 살아있는 포켓몬 출전(강제 교체).
  forceSwitchIfFainted(match.challenger, messages);
  forceSwitchIfFainted(match.opponent, messages);

  match.roundLogs.push({
    round: match.round,
    messages,
    challengerHp: match.challenger.team[match.challenger.activeIndex].hp,
    opponentHp: match.opponent.team[match.opponent.activeIndex].hp,
  });

  // 승패 판정: 한쪽이라도 전멸이면 종료.
  const cWiped = isWipedOut(asEngineSide(match.challenger));
  const oWiped = isWipedOut(asEngineSide(match.opponent));
  if (cWiped || oWiped) {
    if (cWiped && oWiped) {
      finishMatch(match, "decided", null, null); // 동시 전멸 = 무승부
    } else if (oWiped) {
      finishMatch(match, "decided", match.challenger.userId, match.opponent.userId);
    } else {
      finishMatch(match, "decided", match.opponent.userId, match.challenger.userId);
    }
    return outcome.consumed;
  }

  // 다음 라운드 준비.
  match.challenger.pendingAction = null;
  match.opponent.pendingAction = null;
  match.round += 1;
  return outcome.consumed;
}

/** 활성 포켓몬이 기절했고 예비가 있으면 다음 살아있는 포켓몬으로 자동 교체. */
function forceSwitchIfFainted(side: PvpSide, messages: string[]): void {
  const engine = asEngineSide(side);
  if (side.team[side.activeIndex].hp > 0) return;
  if (!hasAliveReserve(engine)) return;
  const nextIndex = side.team.findIndex((p, i) => i !== side.activeIndex && p.hp > 0);
  if (nextIndex === -1) return;
  side.activeIndex = nextIndex;
  const mon = side.team[nextIndex];
  // 강제 교체로 나온 포켓몬도 랭크·휘발성 초기화.
  mon.statStages = freshStatStages();
  mon.volatile = [];
  messages.push(`${side.nickname}: ${mon.nickname ?? mon.species}을(를) 내보냈다!`);
}

// --- 기권 ---------------------------------------------------------------------

export async function forfeit(userId: string, matchId: string): Promise<PvpMatch> {
  const result = await updateMatch(matchId, (match) => {
    if (match.status === "finished") {
      throw new GameRuleError("이미 종료된 매치입니다.");
    }
    const key = sideKeyOf(match, userId);
    match[key].forfeited = true;
    // pending(상대 미수락) 상태의 기권은 승패가 성립하지 않는다 — 상대는 아직 stake도
    // 걸지 않았으므로 voided로 종료해 에스크로(challenger분)를 원소유자에게 반환한다.
    if (match.status === "pending") {
      finishMatch(match, "voided", null, null);
    } else {
      const winnerKey = key === "challenger" ? "opponent" : "challenger";
      finishMatch(match, "forfeit", match[winnerKey].userId, match[key].userId);
    }
    return match;
  });
  if (!result) throw new GameRuleError("매치를 찾을 수 없습니다.", 404);
  // forfeit → 승자가 에스크로 획득(points 스틸 포함) / voided → 반환.
  return settleIfFinished(result);
}

// --- 채팅 ---------------------------------------------------------------------

const MAX_CHAT_LENGTH = 500;

export async function postChat(userId: string, matchId: string, text: string): Promise<PvpChatMessage> {
  const trimmed = text.trim();
  if (!trimmed) throw new GameRuleError("빈 메시지는 보낼 수 없습니다.");
  if (trimmed.length > MAX_CHAT_LENGTH) {
    throw new GameRuleError(`메시지는 ${MAX_CHAT_LENGTH}자 이하여야 합니다.`);
  }
  let saved: PvpChatMessage | null = null;
  const result = await updateMatch(matchId, (match) => {
    const key = sideKeyOf(match, userId); // 참가자 검증
    const msg: PvpChatMessage = {
      id: crypto.randomUUID(),
      userId,
      nickname: match[key].nickname,
      text: trimmed,
      at: new Date().toISOString(),
    };
    match.chat.push(msg);
    saved = msg;
    return match;
  });
  if (!result || !saved) throw new GameRuleError("매치를 찾을 수 없습니다.", 404);
  return saved;
}

// --- 조회(폴링) ---------------------------------------------------------------

/**
 * 폴링용 매치 조회. pending 도전이 만료됐으면 lazy하게 종료 처리한 뒤 반환한다.
 * 참가자가 아니면 403.
 */
export async function getMatchForUser(userId: string, matchId: string): Promise<PvpMatch> {
  const match = await getMatch(matchId);
  if (!match) throw new GameRuleError("매치를 찾을 수 없습니다.", 404);
  if (match.challenger.userId !== userId && match.opponent.userId !== userId) {
    throw new GameRuleError("이 매치를 볼 권한이 없습니다.", 403);
  }
  if (match.status === "pending" && isExpired(match)) {
    const updated = await updateMatch(matchId, (m) => {
      if (m.status === "pending" && isExpired(m)) {
        finishMatch(m, "expired", null, null);
        return m;
      }
      return m;
    });
    // expired → challenger 에스크로 반환(wager).
    return updated ? settleIfFinished(updated) : match;
  }
  return match;
}

export async function listMatches(userId: string): Promise<PvpMatch[]> {
  return listMatchesForUser(userId);
}

// --- 랭킹/전적(Phase 2) -------------------------------------------------------

/** 리더보드(레이팅 내림차순). */
export async function getRanking(limit?: number) {
  return listRanking(limit);
}

/** 특정 유저의 전적·ELO. 미등록(전적 없음)이면 config 시작 레이팅으로 0전적 반환. */
export async function getUserStats(userId: string) {
  const stats = await getStats(userId);
  if (stats) return stats;
  const { elo } = (await getConfig()).pvp;
  return { userId, nickname: userId, rating: elo.start, wins: 0, losses: 0, draws: 0, updatedAt: new Date().toISOString() };
}

// --- 공통 헬퍼 ----------------------------------------------------------------

function isExpired(match: PvpMatch): boolean {
  return match.expiresAt != null && new Date(match.expiresAt).getTime() < Date.now();
}

/** 매치를 finished로 종료하고 result를 채운다. */
function finishMatch(
  match: PvpMatch,
  kind: PvpResultKind,
  winnerUserId: string | null,
  loserUserId: string | null,
): void {
  match.status = "finished";
  match.expiresAt = undefined;
  match.result = {
    kind,
    winnerUserId,
    loserUserId,
    finishedAt: new Date().toISOString(),
  };
}
