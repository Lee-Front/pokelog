import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { defaultStatStages } from "../game/battle.js";
import { attemptCapture, getCatchRate } from "../game/capture.js";
import { wildPokemonToOwned } from "../game/pokemon-factory.js";
import { getMoveById, getSpeciesByName } from "../game/data-loader.js";
import { getZPower } from "../game/z-moves.js";
import type { BattleState, MoveData, OwnedPokemon, UserData } from "../../../../shared/types.js";
import { decrementItem, healPokemon } from "../game/inventory-utils.js";
import { recordMoveUsage } from "../game/move-usage.js";
import { grantBattleRewards } from "../game/battle-rewards.js";
import { getEvYield, applyEvGain, emptyEvs } from "../game/evs.js";
import { buildStatsForPokemon } from "../game/pokemon-stats.js";
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
import { childLogger } from "../logger.js";

const log = childLogger("battle-routes");

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
): void {
  // "lose"만 전투 종료 — "fainted"는 강제 교체로 전투가 계속된다.
  if (result.result === "lose") logBattleEnd(userId, battle, "lose");
  res.json({ log: result.log, battleState: result.battleState, result: result.result });
}

/**
 * Finalize a wild-battle win: clear the encounter/battle state, grant rewards to
 * the winning Pokemon and the user, persist, and respond with the reward
 * summary. Called from each win exit in handleFight.
 */
async function finishWin(
  user: UserData, winner: OwnedPokemon, battle: BattleState, log: string[], res: Response,
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

  const rewards = grantBattleRewards(user, participants, wild, config.battle);

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

  await saveUser(user);
  logBattleEnd(user.account.id, battle, "win");
  res.json({
    log,
    battleState: null,
    result: "win",
    rewards,
    transformationType: wonTransformationType,
    playerBattleForm: wonPlayerBattleForm,
  });
}

battleRoutes.post("/start", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { eventId, pokemonUid } = req.body;

    if (typeof eventId !== "string" || typeof pokemonUid !== "string") {
      res.status(400).json({ error: "이벤트 ID와 포켓몬 UID를 입력해주세요" });
      return;
    }

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

    const battleState: BattleState = {
      eventId,
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
    battleState.wildStatStages = applySwitchInAbilities(battleState, "player", pokemon, battleState.wildStatStages, startLog);
    battleState.playerStatStages = applySwitchInAbilities(battleState, "wild", battleState.wild, battleState.playerStatStages, startLog);

    user.battleState = battleState;
    await saveUser(user);
    void appendEvent({
      type: "battle_start",
      userId: user.account.id,
      detail: {
        eventId,
        wildSpecies: battleState.wild.species,
        wildLevel: battleState.wild.level,
        myPokemonUid: pokemonUid,
        mySpecies: pokemon.species,
        myLevel: pokemon.level,
      },
    });
    res.json({ battleState, log: startLog });
  } catch (err) {
    log.error({ err }, "Battle start error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

async function handleFight(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
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
    const faintResult = await handleFainted(user, myPokemon, battle, log);
    if (faintResult) { sendFaintedResponse(res, faintResult, user.account.id, battle); return; }
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
      const attackResult = executePlayerAttack(battle, myPokemon, selectedMoveData, selectedMove, log);
      if (battle.wild.hp <= 0) {
        await finishWin(user, myPokemon, battle, log, res);
        return;
      }
      if (attackResult.flinchCaused) {
        log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}은(는) 풀이 죽어 움직이지 못했다!`);
      } else {
        const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log, wildChosenMove ?? undefined);
        if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle); return; }
      }
    } else {
      const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log, wildChosenMove ?? undefined);
      if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle); return; }
    }
  } else {
    const wildResult = await doWildAttackAndCheck(user, myPokemon, battle, log, wildChosenMove ?? undefined);
    if (wildResult) { sendFaintedResponse(res, wildResult, user.account.id, battle); return; }
    // 야생이 선공하며 풀죽음을 유발했으면 플레이어는 이번 턴 행동 불가(임시 플래그 즉시 해제).
    const playerFlinched = battle.playerFlinched ?? false;
    battle.playerFlinched = false;
    if (playerFlinched) {
      log.push(`${getDisplaySpeciesName(myPokemon.species)}은(는) 풀이 죽어 움직이지 못했다!`);
    } else if (playerCanAct) {
      recordMoveUsage(myPokemon, selectedMove.id);
      executePlayerAttack(battle, myPokemon, selectedMoveData, selectedMove, log);
      if (battle.wild.hp <= 0) {
        await finishWin(user, myPokemon, battle, log, res);
        return;
      }
    }
  }

  // End-of-turn: status/volatile ticks, gmax countdown, weather damage
  applyEndOfTurnBattle(battle, myPokemon, log);
  applyWeatherEndOfTurn(battle, myPokemon, log);
  applyTerrainEndOfTurn(battle, myPokemon, log);

  // Check if end-of-turn damage KO'd anyone
  if (myPokemon.hp <= 0) {
    const faintResult = await handleFainted(user, myPokemon, battle, log);
    if (faintResult) { sendFaintedResponse(res, faintResult, user.account.id, battle); return; }
  }
  if (battle.wild.hp <= 0) {
    await finishWin(user, myPokemon, battle, log, res);
    return;
  }

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleCatch(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
) {
  const ballType = typeof data?.ball === "string" ? data.ball : "pokeball";

  if (!user.inventory[ballType] || user.inventory[ballType] <= 0) {
    res.status(400).json({ error: "볼이 없습니다" });
    return;
  }

  const config = await getConfig();
  const ballItem = config.shop.items[ballType];
  const catchBonus = ballItem?.catchBonus ?? 0;
  const guaranteedCatch = ballItem?.guaranteedCatch ?? false;

  decrementItem(user.inventory, ballType);

  const baseCatchRate = getCatchRate(battle.wild.species);
  const caught = guaranteedCatch || attemptCapture(catchBonus, battle.wild.hp, battle.wild.maxHp, baseCatchRate);

  if (caught) {
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}을(를) 잡았다!`);
    const newPokemon = wildPokemonToOwned(battle.wild);

    if (user.party.length < 6) {
      user.pokemon.push(newPokemon);
      user.party.push(newPokemon.uid);
    } else {
      user.storage.push(newPokemon);
    }

    if (!user.pokedex.includes(battle.wild.species)) {
      user.pokedex.push(battle.wild.species);
    }

    // 포획 보상 EV — 잡은 야생 종의 수확량을 현재 출전 중인 개체에게 적립한다(살아있을 때만).
    // 포켓루스 감염 개체는 2배. 적립 후 스탯을 재계산하되 현재 HP는 보존(클램프).
    if (myPokemon.hp > 0) {
      const baseYield = getEvYield(battle.wild.species);
      const mult = myPokemon.pokerus ? 2 : 1;
      const evGain =
        mult === 1
          ? baseYield
          : Object.fromEntries(
              Object.entries(baseYield).map(([key, value]) => [key, (value ?? 0) * mult]),
            );
      myPokemon.evs = applyEvGain(myPokemon.evs ?? emptyEvs(), evGain);
      const recomputed = buildStatsForPokemon(myPokemon);
      myPokemon.maxHp = recomputed.maxHp;
      myPokemon.hp = Math.min(myPokemon.hp, myPokemon.maxHp);
      myPokemon.stats = recomputed.stats;
    }

    user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
    revertBattleForms(battle, myPokemon);
    user.battleState = null;
    await saveUser(user);
    logBattleEnd(user.account.id, battle, "caught");
    res.json({ log, battleState: null, result: "caught", pokemon: newPokemon });
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
  const shopItem = config.shop.items[itemId];
  if (!shopItem || !shopItem.healAmount) {
    res.status(400).json({ error: "전투에서 사용할 수 없는 아이템입니다" });
    return;
  }

  if (!user.inventory[itemId] || user.inventory[itemId] <= 0) {
    res.status(400).json({ error: "아이템이 없습니다" });
    return;
  }

  const target = user.pokemon.find((p) => p.uid === targetUid);
  if (!target) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }

  decrementItem(user.inventory, itemId);
  healPokemon(target, shopItem.healAmount);
  log.push(`${shopItem.name}을(를) 사용했다! HP가 ${shopItem.healAmount} 회복되었다!`);

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

    const user = await getUser(userId!);
    if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다" }); return; }

    if (!user.battleState) { res.status(400).json({ error: "전투 중이 아닙니다" }); return; }

    const battle = user.battleState;
    const myPokemon = user.pokemon.find((p) => p.uid === battle.myPokemonUid);
    if (!myPokemon) { res.status(400).json({ error: "전투 포켓몬을 찾을 수 없습니다" }); return; }

    const log: string[] = [];
    battle.turn += 1;

    switch (action) {
      case "fight":  await handleFight(user, myPokemon, battle, data ?? {}, log, res); break;
      case "catch":  await handleCatch(user, myPokemon, battle, data ?? {}, log, res); break;
      case "item":   await handleItem(user, myPokemon, battle, data ?? {}, log, res); break;
      case "switch": await handleSwitch(user, myPokemon, battle, data ?? {}, log, res); break;
      case "run":    await handleRun(user, myPokemon, battle, log, res); break;
      default:       res.status(400).json({ error: "유효하지 않은 행동입니다" });
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
