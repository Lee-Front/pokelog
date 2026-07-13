import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withLock } from "../storage/pvp-store.js";
import { getConfig } from "../storage/config-store.js";
import { defaultStatStages } from "../game/battle.js";
import { attemptCapture, getCatchRate } from "../game/capture.js";
import { wildPokemonToOwned } from "../game/pokemon-factory.js";
import { getMoveById, getSpeciesByName } from "../game/data-loader.js";
import { getZPower } from "../game/z-moves.js";
import type { BattleHpFrame, BattleState, MoveData, OwnedPokemon, PendingEvent, UserData } from "../../../../shared/types.js";
import { decrementItem, healPokemon, resolveShopItem, applyStatusCure } from "../game/inventory-utils.js";
import { recordMoveUsage } from "../game/move-usage.js";
import { grantBattleRewards } from "../game/battle-rewards.js";
import { BOSSES, getCurrentBoss, getIsoWeek, grantBossRewardOnce, ballsForRank } from "../game/weekly-boss.js";
import { registerBossClear } from "../storage/boss-clears-store.js";
import { getDisplaySpeciesName } from "../game/pokemon-state.js";
import { checkTurnForm } from "../game/battle-forms.js";
import {
  checkPrimalReversion, canMegaEvolve, canGigantamax,
  getTransformedStats, applyGmaxHp, revertGmaxHp, getGmaxMove,
} from "../game/battle-transformations.js";
import {
  applyBattleFormChange, applyWeatherEndOfTurn, applyTerrainEndOfTurn,
  revertBattleForms,
  executePlayerAttack, resolvePreAttack, determineBattleTurnOrder, applyEndOfTurnBattle,
  handleFainted, doWildAttackAndCheck,
  type FaintedResult,
} from "../game/battle-state.js";
import { applySwitchInAbilities } from "../game/abilities.js";
import { appendEvent } from "../storage/event-log.js";
import { syncWorldBossDamage, distributeWorldBossDefeatRewards } from "../game/world-boss-sync.js";
import { childLogger } from "../logger.js";

/**
 * 월드보스 처치 보상 배분 지연 홀더 — handleFight가 이번 턴 막타를 감지하면 대상 bossId를 담고,
 * /action 핸들러가 배틀 user 락을 '놓은 뒤' distributeWorldBossDefeatRewards로 배분한다.
 * (배분은 각 유저 락을 잡으므로 배틀 user 락 안에서 하면 user↔user 교차 교착 위험 — 락 순서 규약.)
 */
interface DeferredBossDistribution { bossId: string | null }

const log = childLogger("battle-routes");

// 테라스탈/Z기술 발동 임시 비활성화. 두 기능 모두 docs/pokemon-mechanics-architecture.md
// 에는 "still deferred"로 남아 있는데도, 아이템/자격 게이트 없이(단순화 MVP) 먼저 들어가
// 어떤 포켓몬이든 배틀당 1회씩 쓸 수 있게 되어 있었다(문서-구현 불일치). 메가/거다이맥스처럼
// 제대로 된 자격 게이트(아이템 등)를 설계하기 전까지 발동 자체를 막는다.
const TERASTAL_ENABLED = false;
const Z_MOVE_ENABLED = false;

/** 시스템 활동 로그: 전투 종료 기록 (result + 야생 종/레벨 + 턴 수). */
function logBattleEnd(
  userId: string,
  battle: BattleState,
  result: "win" | "lose" | "caught" | "run",
): void {
  // 로깅 실패가 전투 응답을 막지 않도록 await하지 않고 띄운다(appendEvent가 내부에서 흡수).
  void appendEvent({
    type: "battle_end",
    userId,
    detail: {
      result,
      wildSpecies: battle.wild.species,
      wildLevel: battle.wild.level,
      turns: battle.turn,
    },
  });
}

export const battleRoutes = Router();
battleRoutes.use(authMiddleware);

function sendFaintedResponse(
  res: Response, result: FaintedResult, userId: string, battle: BattleState,
  // 야생전 fight 턴만 실제 프레임을 넘긴다. 다른 호출처(catch/item/switch)는 생략 → [] 로
  // 클라이언트가 종전처럼 최종 상태로 스냅한다(하위호환).
  hpFrames: BattleHpFrame[] = [],
): void {
  // "lose"만 전투 종료 — "fainted"는 강제 교체로 전투가 계속된다.
  if (result.result === "lose") logBattleEnd(userId, battle, "lose");
  res.json({ log: result.log, battleState: result.battleState, result: result.result, hpFrames });
}

/**
 * Finalize a wild-battle win: clear the encounter/battle state, grant rewards to
 * the winning Pokemon and the user, persist, and respond with the reward
 * summary. Called from each win exit in handleFight.
 */
async function finishWin(
  user: UserData, winner: OwnedPokemon, battle: BattleState, log: string[], res: Response,
  // 야생전 fight 턴만 실제 프레임을 넘긴다(승리 프레임엔 killing blow가 이미 담겨 있다).
  // handleFight 외 호출처는 없지만 다른 호출처 추가 시에도 종전 스냅 동작이 되도록 기본 [].
  hpFrames: BattleHpFrame[] = [],
): Promise<void> {
  log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}이(가) 쓰러졌다!`);
  const config = await getConfig();
  const wild = { species: battle.wild.species, level: battle.wild.level };

  user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
  // 변신(메가/거다이/원시)이 승리와 같은 턴에 일어나면 battleState가 null로 응답되어 변신 폼이
  // 클라이언트에 전달되지 않아 이미지가 안 바뀐다. revertBattleForms가 폼을 지우기 전에 캡처해
  // 응답에 함께 실어, 결과 화면에서도 변신한 모습이 보이게 한다.
  const wonTransformationType = battle.transformationType ?? null;
  const wonPlayerBattleForm = battle.playerBattleForm ?? null;
  revertBattleForms(battle, winner);
  user.battleState = null;

  // 참여(필드에 나온) 포켓몬 전원을 EXP 대상으로. 현재 출전 중인 winner를 항상 맨 앞에 두고,
  // participantUids에 기록된 나머지 참여자를 user.pokemon에서 찾아 뒤에 붙인다(중복 제거).
  const seen = new Set<string>([winner.uid]);
  const participants: OwnedPokemon[] = [winner];
  for (const uid of battle.participantUids ?? []) {
    if (seen.has(uid)) continue;
    const p = user.pokemon.find((x) => x.uid === uid);
    if (!p) continue;
    seen.add(uid);
    participants.push(p);
  }

  // 보스전은 경험치·EV·Exp Share는 그대로 주되(진짜 전투) 야생 상금/드랍(spoils)은 주지 않는다 —
  // 헤드라인은 주 1회 보스 보상이다(아래 boss 훅). 일반 야생전은 종전대로 spoils 포함.
  const rewards = grantBattleRewards(user, participants, wild, config.battle, { includeSpoils: !battle.isBoss });

  // 참여 포켓몬별 EXP/레벨업/진화 로그(살아있는 참여자만 rewards.partyExp에 들어온다).
  for (const member of rewards.partyExp ?? []) {
    if (member.exp > 0) log.push(`${getDisplaySpeciesName(member.species)}은(는) ${member.exp} 경험치를 얻었다!`);
    if (member.leveledUp) log.push(`${getDisplaySpeciesName(member.species)}은(는) 레벨 ${member.newLevel}이(가) 되었다!`);
    if (member.evolvedInto) log.push(`${getDisplaySpeciesName(member.species)}(으)로 진화했다!`);
  }
  if (rewards.gameMoney > 0) log.push(`게임머니 ${rewards.gameMoney}을(를) 획득했다!`);
  for (const drop of rewards.droppedItems) {
    log.push(`${drop.item} ${drop.qty}개를 주웠다!`);
  }

  // 주간보스 처치 훅 — 주(ISO week)당 1회 보상 지급. 이미 이번 주에 처치했다면(멱등 가드)
  // 재지급하지 않고 "이미 수령" 안내만 남긴다. 응답에 boss 요약을 실어 클라가 처치를 인지한다.
  let bossSummary:
    | { defeated: true; alreadyClaimed: boolean; rank?: number; points?: number; capture?: { ballAttempts: number } }
    | undefined;
  if (battle.isBoss && battle.bossId) {
    const now = new Date();
    const week = getIsoWeek(now);
    const boss = getCurrentBoss(now);
    // 실제로 싸운 보스 이름으로 처치 로그를 남긴다(주 경계 롤오버 시 현재 보스와 다를 수 있음).
    const foughtBoss = BOSSES.find((b) => b.id === battle.bossId) ?? boss;
    log.push(`주간보스 ${foughtBoss.name}을(를) 쓰러뜨렸다!`);
    // 진행 중이던 보스가 현재 주 보스와 다르면(주 경계에서 로테이션이 바뀐 경우) 보상 없이 처치만 인정.
    if (boss.id === battle.bossId) {
      const grant = grantBossRewardOnce(user, boss, week);
      if (grant.granted) {
        // 순위 보상 — 이번 주 이 보스를 이번이 처음 처치인 유저만 랭킹에 등록되므로(grantBossRewardOnce
        // 의 멱등 가드와 1:1), 순위·포인트는 항상 이 유저의 "선착 순번"을 정확히 반영한다.
        const clear = await registerBossClear(week, boss.id, user.account.id, user.account.nickname);
        user.points += clear.points;
        user.bossDefeatTotal = (user.bossDefeatTotal ?? 0) + 1;
        if (clear.rank === 1) user.bossFirstPlaceTotal = (user.bossFirstPlaceTotal ?? 0) + 1;

        // 이번 주 첫 처치 → 순위(ballsForRank)에 따른 포획 시도권 배분. 월드보스와 달리 유저 락 안(이번 훅
        // 전체가 per-user 락)에서 지급하면 되고, grant.granted 멱등 가드가 주당 1회만 실어주므로 재지급이 없다.
        // 실제 싸운 보스(foughtBoss)의 종/변종과 그 전투의 유효 레벨(battle.wild.level)로 개체를 특정한다.
        const captureBalls = ballsForRank(clear.rank, config.weeklyBoss);
        user.weeklyBossCapture = {
          species: foughtBoss.species,
          variantId: foughtBoss.variantId ?? null,
          level: battle.wild.level,
          shiny: false,
          ballItem: config.weeklyBoss.captureBall,
          ballAttempts: captureBalls,
          bossId: boss.id,
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        };

        log.push(`이번 주 ${clear.rank}번째로 처치! 포인트 ${clear.points}을(를) 획득했다!`);
        bossSummary = { defeated: true, alreadyClaimed: false, rank: clear.rank, points: clear.points, capture: { ballAttempts: captureBalls } };
      } else {
        log.push("이번 주에는 이미 보스 보상을 받았습니다.");
        bossSummary = { defeated: true, alreadyClaimed: true };
      }
    } else {
      bossSummary = { defeated: true, alreadyClaimed: false };
    }
  }

  await saveUser(user);
  logBattleEnd(user.account.id, battle, "win");
  res.json({
    log,
    battleState: null,
    result: "win",
    rewards,
    boss: bossSummary,
    transformationType: wonTransformationType,
    playerBattleForm: wonPlayerBattleForm,
    hpFrames,
  });
}

/**
 * 야생 전투 시작 코어 — 이미 검증된 (event, pokemonUid)로 battleState를 만들어 user에 세팅·저장하고
 * {battleState, log}를 반환한다. 수동 전투 시작(POST /battle/start)과 자동 탐색 보관함 전투 시작
 * (POST /game/stored/:id/battle)이 공유한다. 입력 검증(400/404)은 호출자가 책임진다 — 여기서는
 * event.pokemon이 유효한 야생이고 pokemonUid가 살아있는 내 포켓몬을 가리킨다고 가정한다.
 *
 * event가 user.pendingEvents/storedEncounters 중 어디서 왔든, 이 함수는 그 배열을 건드리지 않는다.
 * 호출자가 필요 시 이동/제거를 먼저 해 두고(같은 user 객체) 호출하면 saveUser가 함께 영속한다.
 */
export async function startWildBattle(
  user: UserData,
  event: PendingEvent,
  pokemonUid: string,
): Promise<{ battleState: BattleState; log: string[] }> {
  const pokemon = user.pokemon.find((p) => p.uid === pokemonUid)!;

  const battleState: BattleState = {
    eventId: event.id,
    myPokemonUid: pokemonUid,
    // 첫 출전 포켓몬을 참여자로 기록(클래식 EXP 분배용). 교체 시 handleSwitch에서 추가.
    participantUids: [pokemonUid],
    turn: 0,
    wild: { ...event.pokemon },
    playerStatStages: defaultStatStages(),
    wildStatStages: defaultStatStages(),
    playerVolatile: [],
    wildVolatile: [],
  };

  // Check primal reversion for active pokemon
  const primalForm = checkPrimalReversion(pokemon);
  if (primalForm) {
    battleState.playerBattleForm = primalForm;
    battleState.transformationType = "primal";
    // Apply primal stats
    const transformed = getTransformedStats(pokemon, primalForm);
    pokemon.stats = transformed.stats;
    pokemon.maxHp = transformed.maxHp;
    pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
  }

  // 야생을 전투에서 마주하면 영구 "만난적(발견)"에 기록 — 잡지 못하고 도망/패배해도 유지된다.
  const seenList = user.seenSpecies ?? (user.seenSpecies = []);
  if (!seenList.includes(battleState.wild.species)) seenList.push(battleState.wild.species);

  // 스위치인 특성(intimidate·날씨/필드 세터): 양측 등장 시 발동.
  // 플레이어 리드가 먼저 등장 → 야생 스탯을 깎고, 이어 야생이 등장 → 플레이어 스탯을 깎는다.
  // 무특성/미지원이면 no-op이라 종전 동작과 동일하다.
  const startLog: string[] = [];
  battleState.wildStatStages = applySwitchInAbilities(battleState, "player", pokemon, battleState.wildStatStages!, startLog);
  battleState.playerStatStages = applySwitchInAbilities(battleState, "wild", battleState.wild, battleState.playerStatStages!, startLog);

  user.battleState = battleState;
  await saveUser(user);
  void appendEvent({
    type: "battle_start",
    userId: user.account.id,
    detail: {
      eventId: event.id,
      wildSpecies: battleState.wild.species,
      wildLevel: battleState.wild.level,
      myPokemonUid: pokemonUid,
      mySpecies: pokemon.species,
      myLevel: pokemon.level,
    },
  });
  return { battleState, log: startLog };
}

battleRoutes.post("/start", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { eventId, pokemonUid } = req.body;

    if (typeof eventId !== "string" || typeof pokemonUid !== "string") {
      res.status(400).json({ error: "이벤트 ID와 포켓몬 UID를 입력해주세요" });
      return;
    }

    await withLock(`user:${userId!}`, async () => {
      const user = await getUser(userId!);
      if (!user) {
        res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
        return;
      }

      const event = user.pendingEvents.find((e) => e.id === eventId);
      if (!event) {
        res.status(404).json({ error: "이벤트를 찾을 수 없습니다" });
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

      const { battleState, log: startLog } = await startWildBattle(user, event, pokemonUid);
      res.json({ battleState, log: startLog });
    });
  } catch (err) {
    log.error({ err }, "Battle start error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

async function handleFight(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
  deferred: DeferredBossDistribution,
) {
  const moveId = data?.moveId;
  if (typeof moveId !== "string") { res.status(400).json({ error: "사용할 기술을 선택해주세요" }); return; }

  const myMove = myPokemon.moves.find((m) => m.id === moveId);
  if (!myMove || myMove.pp <= 0) { res.status(400).json({ error: "사용할 수 없는 기술입니다" }); return; }

  const moveData = getMoveById(moveId);
  if (!moveData) { res.status(400).json({ error: "기술 데이터를 찾을 수 없습니다" }); return; }

  // Handle mega evolution
  const mega = data?.mega as boolean | undefined;
  if (mega) {
    const result = canMegaEvolve(myPokemon, battle, user.inventory);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    battle.playerBattleForm = result.variantId!;
    battle.transformationType = "mega";
    battle.transformationUsed = true;
    // Apply variant stats
    const transformed = getTransformedStats(myPokemon, result.variantId!);
    myPokemon.stats = transformed.stats;
    myPokemon.maxHp = transformed.maxHp;
    if (myPokemon.hp > myPokemon.maxHp) myPokemon.hp = myPokemon.maxHp;
    log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) 메가진화했다!`);
  }

  // Handle gigantamax
  const gigantamax = data?.gigantamax as boolean | undefined;
  if (gigantamax) {
    const result = canGigantamax(myPokemon, battle, user.inventory);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    battle.playerBattleForm = result.variantId!;
    battle.transformationType = "gigantamax";
    battle.transformationUsed = true;
    battle.gmaxTurnsRemaining = 3;
    battle.playerPreTransformMaxHp = myPokemon.maxHp;
    const gmaxHp = applyGmaxHp(myPokemon.hp, myPokemon.maxHp);
    myPokemon.hp = gmaxHp.hp;
    myPokemon.maxHp = gmaxHp.maxHp;
    log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) 기가맥스했다!`);
  }

  // Handle terastal (플레이어 전용·배틀당 1회, 메가/거다이 게이트와 독립)
  // 아이템(테라오브) 없이 행동 플래그 + 1회 게이트만으로 발동(단순화 — z-moves.ts/문서 참조).
  // teraType은 개체의 teraType, 없으면 종 1차 타입으로 기본값. 스탯은 안 바뀌고 타이핑만 바뀐다.
  const terastal = data?.terastal as boolean | undefined;
  if (terastal === true) {
    if (!TERASTAL_ENABLED) { res.status(400).json({ error: "테라스탈은 현재 비활성화된 기능입니다" }); return; }
    if (battle.playerTerastallized) { res.status(400).json({ error: "이번 배틀에서 이미 테라스탈했습니다" }); return; }
    const primaryType = getSpeciesByName(myPokemon.species)?.types?.[0];
    const teraType = myPokemon.teraType ?? primaryType;
    if (!teraType) { res.status(400).json({ error: "테라스탈 타입을 결정할 수 없습니다" }); return; }
    battle.playerTeraType = teraType;
    battle.playerTerastallized = true;
    log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) ${teraType}테라스탈했다!`);
  }

  const selectedMove = myMove;
  let selectedMoveData = moveData;

  // Handle Z-move (플레이어 전용·배틀당 1회, 공격기 전용)
  // 위력만 Z파워로 증폭(크리스탈 타입 매칭·Z상태기 없음 — 단순화 MVP, z-moves.ts 참조).
  // 공유 무브 데이터를 변형하지 않도록 얕은 복제본으로 위력을 덮어쓴다.
  const zmove = data?.zmove as boolean | undefined;
  if (zmove === true) {
    if (!Z_MOVE_ENABLED) { res.status(400).json({ error: "Z기술은 현재 비활성화된 기능입니다" }); return; }
    if (battle.zMoveUsed) { res.status(400).json({ error: "이번 배틀에서 이미 Z기술을 사용했습니다" }); return; }
    if (moveData.category === "status" || moveData.power <= 0) {
      res.status(400).json({ error: "Z기술은 공격기에만 쓸 수 있습니다" }); return;
    }
    battle.zMoveUsed = true;
    selectedMoveData = { ...moveData, power: getZPower(moveData.power) };
    log.push(`${getDisplaySpeciesName(myPokemon.species)}의 Z파워가 폭발한다!`);
  }

  // G-Max move substitution: when Gigantamaxed, replace matching-type moves
  if (battle.transformationType === "gigantamax" && selectedMoveData.category !== "status") {
    const gmaxSpecies = myPokemon.variantId?.replace(/-gmax$/, "") ?? myPokemon.species;
    const gmaxMoveId = getGmaxMove(gmaxSpecies, selectedMoveData.type);
    if (gmaxMoveId) {
      const gmaxMoveData = getMoveById(gmaxMoveId);
      if (gmaxMoveData) {
        selectedMoveData = gmaxMoveData;
        log.push(`${selectedMove.id}이(가) ${gmaxMoveData.name}(으)로 변했다!`);
      }
    }
  }

  // 이 턴의 HP 타임라인 — HP가 바뀌는 단계 직후마다 (플레이어 hp, 야생 hp) 스냅샷을 쌓는다.
  // 코드가 실제 실행하는 순서(선공/후공 분기 포함) 그대로 담기며, 마지막 프레임은 클라이언트가
  // 종전에 스냅하던 최종 상태와 정확히 일치한다. 클라이언트는 이 프레임들을 순차로 재생해 공격
  // 순서대로 게이지를 깎는다. (야생전 fight 턴 전용 — 프레임이 없으면 종전과 동일하게 스냅.)
  const hpFrames: BattleHpFrame[] = [];
  const pushFrame = () => hpFrames.push({ playerHp: myPokemon.hp, wildHp: battle.wild.hp });

  // Pre-select wild move to get its priority for turn order
  const wildAvailableMoves = battle.wild.moves.filter((m) => m.pp > 0);
  const wildChosenMove = wildAvailableMoves.length > 0
    ? wildAvailableMoves[Math.floor(Math.random() * wildAvailableMoves.length)]
    : null;
  const wildMoveData = wildChosenMove ? getMoveById(wildChosenMove.id) : null;

  // Pre-attack check for player (handles sleep decrement, freeze, paralysis, confusion)
  const preAttack = resolvePreAttack(myPokemon, battle.playerVolatile ?? [], log);
  const playerCanAct = preAttack.canAct;
  if (!playerCanAct && preAttack.selfDamage) {
    myPokemon.hp = Math.max(0, myPokemon.hp - preAttack.selfDamage);
    log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) ${preAttack.selfDamage} 데미지를 받았다!`);
    pushFrame(); // 혼란 등 행동불가 자해 데미지
    const faintResult = await handleFainted(user, myPokemon, battle, log);
    if (faintResult) { sendFaintedResponse(res, faintResult, user.account.id, battle, hpFrames); return; }
  }

  // Determine turn order (paralysis speed halving + stat stages applied inside)
  const turnOrder = determineBattleTurnOrder(battle, myPokemon, selectedMoveData, wildMoveData ?? { priority: 0 }, log);

  // Turn start form checks (morpeko)
  applyBattleFormChange(
    battle,
    checkTurnForm(myPokemon.species, battle.turn, battle.playerBattleForm ?? myPokemon.variantId ?? null),
    "player", log,
  );
  applyBattleFormChange(
    battle,
    checkTurnForm(battle.wild.species, battle.turn, battle.wildBattleForm ?? battle.wild.variantId ?? null),
    "wild", log,
  );

  // 풀죽음 임시 플래그는 매 턴 시작 시 초기화(다른 호출처가 설정해도 영속되지 않게).
  battle.playerFlinched = false;

  if (turnOrder === "player") {
    if (playerCanAct) {
      recordMoveUsage(myPokemon, selectedMove.id);
      const wildHpBefore = battle.wild.hp;
      const attackResult = executePlayerAttack(battle, myPokemon, selectedMoveData, selectedMove, log);
      // 월드보스: 이번 턴 보스HP 감소분을 공유 체력에 반영하고 battle.wild.hp를 새 globalHp로 맞춘다.
      // 막타면 배분은 지연(락 밖에서 실행) — deferred에 대상 보스만 담는다.
      if (battle.isWorldBoss) {
        const sync = await syncWorldBossDamage(battle, user, Math.max(0, wildHpBefore - battle.wild.hp));
        if (sync.distributePending) deferred.bossId = sync.bossId;
      }
      pushFrame(); // 플레이어 공격 (야생 hp 감소, 격파 시 0 포함)
      if (battle.wild.hp <= 0) {
        await finishWin(user, myPokemon, battle, log, res, hpFrames);
        return;
      }
      if (attackResult.flinchCaused) {
        log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}은(는) 풀이 죽어 움직이지 못했다!`);
      } else {
        const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log, wildChosenMove ?? undefined);
        pushFrame(); // 야생 반격 (플레이어 hp 감소, 기절 시 0 포함)
        if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle, hpFrames); return; }
      }
    } else {
      const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log, wildChosenMove ?? undefined);
      pushFrame(); // 행동불가 상태에서 야생 공격
      if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle, hpFrames); return; }
    }
  } else {
    const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log, wildChosenMove ?? undefined);
    pushFrame(); // 야생 선공 (플레이어 hp 감소, 기절 시 0 포함)
    if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle, hpFrames); return; }
    // 야생이 선공하며 풀죽음을 유발했으면 플레이어는 이번 턴 행동 불가(임시 플래그 즉시 해제).
    const playerFlinched = battle.playerFlinched ?? false;
    battle.playerFlinched = false;
    if (playerFlinched) {
      log.push(`${getDisplaySpeciesName(myPokemon.species)}은(는) 풀이 죽어 움직이지 못했다!`);
    } else if (playerCanAct) {
      recordMoveUsage(myPokemon, selectedMove.id);
      const wildHpBefore = battle.wild.hp;
      executePlayerAttack(battle, myPokemon, selectedMoveData, selectedMove, log);
      // 월드보스: 이번 턴 보스HP 감소분을 공유 체력에 반영하고 battle.wild.hp를 새 globalHp로 맞춘다.
      if (battle.isWorldBoss) {
        const sync = await syncWorldBossDamage(battle, user, Math.max(0, wildHpBefore - battle.wild.hp));
        if (sync.distributePending) deferred.bossId = sync.bossId;
      }
      pushFrame(); // 플레이어 후공 (야생 hp 감소, 격파 시 0 포함)
      if (battle.wild.hp <= 0) {
        await finishWin(user, myPokemon, battle, log, res, hpFrames);
        return;
      }
    }
  }

  // End-of-turn: status/volatile ticks, gmax countdown, weather damage
  const wildHpBeforeEot = battle.wild.hp;
  applyEndOfTurnBattle(battle, myPokemon, log);
  applyWeatherEndOfTurn(battle, myPokemon, log);
  applyTerrainEndOfTurn(battle, myPokemon, log);
  // 월드보스: 턴 종료 데미지(독·화상·날씨·필드)도 공유 체력에 반영한다. 회복(음수 델타)은 무시하고
  // battle.wild.hp만 globalHp로 되돌린다(단일 플레이어의 회복이 공유체력을 부풀리지 않게).
  if (battle.isWorldBoss) {
    const sync = await syncWorldBossDamage(battle, user, Math.max(0, wildHpBeforeEot - battle.wild.hp));
    if (sync.distributePending) deferred.bossId = sync.bossId;
  }
  pushFrame(); // 턴 종료 데미지/회복 (독·화상·날씨·필드 등). 변화 없으면 클라가 no-op 프레임으로 스킵.

  // Check if end-of-turn damage KO'd anyone
  if (myPokemon.hp <= 0) {
    const faintResult = await handleFainted(user, myPokemon, battle, log);
    if (faintResult) { sendFaintedResponse(res, faintResult, user.account.id, battle, hpFrames); return; }
  }
  if (battle.wild.hp <= 0) {
    await finishWin(user, myPokemon, battle, log, res, hpFrames);
    return;
  }

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue", hpFrames });
}

async function handleCatch(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
) {
  // 주간보스·월드보스는 (전투 중엔) 잡을 수 없다 — 볼을 소모하지 않고 즉시 거부(턴도 소비하지 않는다).
  // 월드보스는 처치 후 별도 포획 페이지(/world-boss/capture)에서 기여도 비례 시도권으로 잡는다.
  if (battle.isBoss || battle.isWorldBoss) { res.status(400).json({ error: "보스는 잡을 수 없다!" }); return; }

  const ballType = typeof data?.ball === "string" ? data.ball : "pokeball";

  if (!user.inventory[ballType] || user.inventory[ballType] <= 0) {
    res.status(400).json({ error: "볼이 없습니다" });
    return;
  }

  const config = await getConfig();
  // 볼(pokeball/greatball/ultraball/safariball)은 battleShop으로 이동했으므로 두 카탈로그를 조회한다.
  // (예전엔 shop.items만 봐서 마스터볼 외 볼의 catchBonus/guaranteedCatch가 먹지 않았다.)
  const ballItem = resolveShopItem(config, ballType);
  // config의 catchBonus는 몬스터볼(=1.0)을 기준으로 한 가산 보너스다(pokeball 0, great 0.2, ultra 0.35).
  // 포획 공식(capture.ts)은 볼 배수를 기대하므로 1을 더해 배수로 변환한다. 그래야 HP를 깎을수록
  // 포획률이 오르는 (1 - hp/maxHp) 항이 실제로 반영된다(변환 없이 0을 넘기면 몬스터볼은 HP 무관 고정 확률).
  const ballCatchMultiplier = 1 + (ballItem?.catchBonus ?? 0);
  const guaranteedCatch = ballItem?.guaranteedCatch ?? false;

  decrementItem(user.inventory, ballType);

  const baseCatchRate = getCatchRate(battle.wild.species);
  const caught = guaranteedCatch || attemptCapture(ballCatchMultiplier, battle.wild.hp, battle.wild.maxHp, baseCatchRate);

  if (caught) {
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}을(를) 잡았다!`);
    const newPokemon = wildPokemonToOwned(battle.wild);

    // 포획도 격파(finishWin)와 동일하게 경험치·EV·Exp Share를 지급한다(본가 6세대+ 규칙).
    // 단 상금/드랍(spoils)은 없다 — includeSpoils:false. 방금 잡은 개체가 Exp Share 대상에
    // 끼지 않도록, 파티에 넣기 '전에' 보상을 계산한다. 참여자 구성은 finishWin과 동일
    // (현재 출전 개체 + participantUids, 중복 제거; grantBattleRewards가 기절 개체는 제외).
    const seen = new Set<string>([myPokemon.uid]);
    const participants: OwnedPokemon[] = [myPokemon];
    for (const uid of battle.participantUids ?? []) {
      if (seen.has(uid)) continue;
      const p = user.pokemon.find((x) => x.uid === uid);
      if (!p) continue;
      seen.add(uid);
      participants.push(p);
    }
    const rewards = grantBattleRewards(
      user,
      participants,
      { species: battle.wild.species, level: battle.wild.level },
      config.battle,
      { includeSpoils: false },
    );
    for (const member of rewards.partyExp ?? []) {
      if (member.exp > 0) log.push(`${getDisplaySpeciesName(member.species)}은(는) ${member.exp} 경험치를 얻었다!`);
      if (member.leveledUp) log.push(`${getDisplaySpeciesName(member.species)}은(는) 레벨 ${member.newLevel}이(가) 되었다!`);
    }

    // 보상 계산 후에 잡은 포켓몬을 파티/보관함에 넣는다.
    if (user.party.length < 6) {
      user.pokemon.push(newPokemon);
      user.party.push(newPokemon.uid);
    } else {
      user.storage.push(newPokemon);
    }

    if (!user.pokedex.includes(battle.wild.species)) {
      user.pokedex.push(battle.wild.species);
    }

    user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
    revertBattleForms(battle, myPokemon);
    user.battleState = null;
    await saveUser(user);
    logBattleEnd(user.account.id, battle, "caught");
    res.json({ log, battleState: null, result: "caught", pokemon: newPokemon, rewards });
    return;
  }

  log.push("잡지 못했다...");
  const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log);
  if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle); return; }

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleItem(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
) {
  const itemId = data?.item;
  const targetUid = typeof data?.pokemonUid === "string" ? data.pokemonUid : battle.myPokemonUid;

  if (typeof itemId !== "string") { res.status(400).json({ error: "사용할 아이템을 선택해주세요" }); return; }

  const config = await getConfig();
  // 회복약이 battleShop으로 이동했으므로 두 카탈로그를 조회해야 전투 중 회복약 사용이 된다.
  const shopItem = resolveShopItem(config, itemId);
  // 전투에서 쓸 수 있는 아이템: 회복약(healAmount) 또는 상태이상 치료제(curesStatus).
  if (!shopItem || (!shopItem.healAmount && !shopItem.curesStatus)) {
    res.status(400).json({ error: "전투에서 사용할 수 없는 아이템입니다" });
    return;
  }

  if (!user.inventory[itemId] || user.inventory[itemId] <= 0) {
    res.status(400).json({ error: "아이템이 없습니다" });
    return;
  }

  const target = user.pokemon.find((p) => p.uid === targetUid);
  if (!target) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }

  if (shopItem.curesStatus) {
    // 상태이상 치료제 — 대상 상태이상을 회복. 대상 상태가 없으면 소모·턴소비 없이 거부한다.
    if (!applyStatusCure(target, shopItem.curesStatus)) {
      res.status(400).json({ error: "치료할 상태이상이 없습니다" });
      return;
    }
    decrementItem(user.inventory, itemId);
    log.push(`${shopItem.name}을(를) 사용했다! 상태이상이 회복되었다!`);
  } else {
    decrementItem(user.inventory, itemId);
    healPokemon(target, shopItem.healAmount);
    log.push(`${shopItem.name}을(를) 사용했다! HP가 ${shopItem.healAmount} 회복되었다!`);
  }

  const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log);
  if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle); return; }

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleSwitch(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
) {
  const newUid = data?.pokemonUid;
  if (typeof newUid !== "string") { res.status(400).json({ error: "교체할 포켓몬을 선택해주세요" }); return; }

  const newPokemon = user.pokemon.find((p) => p.uid === newUid);
  if (!newPokemon) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }

  if (newPokemon.hp <= 0) {
    res.status(400).json({ error: "기절한 포켓몬으로 교체할 수 없습니다" });
    return;
  }

  const forced = data?.forced === true;

  // Revert transformation on the outgoing pokemon
  if (battle.transformationType === "gigantamax" && battle.playerPreTransformMaxHp != null) {
    const reverted = revertGmaxHp(myPokemon.hp, myPokemon.maxHp, battle.playerPreTransformMaxHp);
    myPokemon.hp = reverted.hp;
    myPokemon.maxHp = reverted.maxHp;
  }
  if (battle.transformationType === "mega" || battle.transformationType === "primal") {
    const originalStats = getTransformedStats(myPokemon, myPokemon.variantId ?? "");
    myPokemon.stats = originalStats.stats;
    myPokemon.maxHp = originalStats.maxHp;
    if (myPokemon.hp > myPokemon.maxHp) myPokemon.hp = myPokemon.maxHp;
  }
  battle.transformationType = null;
  battle.gmaxTurnsRemaining = undefined;
  battle.playerPreTransformMaxHp = undefined;

  battle.myPokemonUid = newUid;
  // 들어온 포켓몬을 참여자로 기록(중복 제거). 승리 시 살아있는 참여자가 풀 EXP를 받는다.
  battle.participantUids = battle.participantUids ?? [];
  if (!battle.participantUids.includes(newUid)) battle.participantUids.push(newUid);
  battle.playerStatStages = defaultStatStages();
  battle.playerVolatile = [];
  battle.playerBattleForm = undefined; // Reset battle form on switch
  log.push(`${getDisplaySpeciesName(newPokemon.species)}(으)로 교체했다!`);

  // 교체로 들어온 포켓몬의 스위치인 특성(intimidate·날씨/필드 세터): 야생 스탯을 깎는다.
  battle.wildStatStages = applySwitchInAbilities(battle, "player", newPokemon, battle.wildStatStages, log);

  if (!forced) {
    const wildResult = await doWildAttackAndCheck(user, newPokemon, battle, log);
    if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle); return; }
  }

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleRun(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState, log: string[], res: Response,
) {
  log.push("무사히 도망쳤다!");
  user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
  revertBattleForms(battle, myPokemon);
  user.battleState = null;
  await saveUser(user);
  logBattleEnd(user.account.id, battle, "run");
  res.json({ log, battleState: null, result: "run" });
}

battleRoutes.post("/action", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { action, data } = req.body;

    if (typeof action !== "string") {
      res.status(400).json({ error: "유효하지 않은 행동입니다" });
      return;
    }

    // 배틀 턴의 유저 데이터 읽기-수정-저장을 user 락으로 직렬화한다(폴링/다른 행동과의 lost-update
    // 방지). 월드보스 처치 보상 배분은 각 유저 락을 잡으므로 이 락 '안'에서 하면 user↔user 교차
    // 교착 위험 — deferred에 대상 보스만 담아 락을 놓은 뒤(아래) 배분한다(락 순서 규약).
    const deferred: DeferredBossDistribution = { bossId: null };
    await withLock(`user:${userId!}`, async () => {
      const user = await getUser(userId!);
      if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

      if (!user.battleState) { res.status(400).json({ error: "전투 중이 아닙니다" }); return; }

      const battle = user.battleState;
      const myPokemon = user.pokemon.find((p) => p.uid === battle.myPokemonUid);
      if (!myPokemon) { res.status(400).json({ error: "전투 포켓몬을 찾을 수 없습니다" }); return; }

      const log: string[] = [];
      battle.turn += 1;

      switch (action) {
        case "fight":  await handleFight(user, myPokemon, battle, data ?? {}, log, res, deferred); break;
        case "catch":  await handleCatch(user, myPokemon, battle, data ?? {}, log, res); break;
        case "item":   await handleItem(user, myPokemon, battle, data ?? {}, log, res); break;
        case "switch": await handleSwitch(user, myPokemon, battle, data ?? {}, log, res); break;
        case "run":    await handleRun(user, myPokemon, battle, log, res); break;
        default:       res.status(400).json({ error: "유효하지 않은 행동입니다" });
      }
    });

    // 배틀 user 락을 놓은 뒤에 월드보스 처치 보상을 나머지 기여자에게 배분한다(막타였을 때만).
    // 막타 유저 본인은 finishWin이 락 안에서 이미 저장했으므로 제외한다(userId로 skip). 응답도 락
    // 안에서 보냈으므로 여기서는 배분만(멱등 — rewardsDistributed 가드가 중복을 막는다).
    if (deferred.bossId) {
      await distributeWorldBossDefeatRewards(deferred.bossId, userId!);
    }
  } catch (err) {
    log.error({ err }, "Battle action error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

battleRoutes.get("/state", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    res.json({ battleState: user.battleState });
  } catch (err) {
    log.error({ err }, "Battle state error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
