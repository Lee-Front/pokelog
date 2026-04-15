import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { defaultStatStages } from "../game/battle.js";
import { attemptCapture, getCatchRate } from "../game/capture.js";
import { wildPokemonToOwned } from "../game/pokemon-factory.js";
import { getMoveById } from "../game/data-loader.js";
import type { BattleState, MoveData, OwnedPokemon, UserData } from "../../../../shared/types.js";
import { decrementItem, healPokemon } from "../game/inventory-utils.js";
import { recordMoveUsage } from "../game/move-usage.js";
import { checkTurnForm } from "../game/battle-forms.js";
import {
  checkPrimalReversion, canMegaEvolve, canGigantamax,
  getTransformedStats, applyGmaxHp, revertGmaxHp, getGmaxMove,
} from "../game/battle-transformations.js";
import {
  applyBattleFormChange, applyWeatherEndOfTurn,
  revertBattleForms,
  executePlayerAttack, resolvePreAttack, determineBattleTurnOrder, applyEndOfTurnBattle,
  handleFainted, doWildAttackAndCheck,
} from "../game/battle-state.js";

export const battleRoutes = Router();
battleRoutes.use(authMiddleware);

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

    if (new Date(event.expiresAt).getTime() < Date.now()) {
      res.status(400).json({ error: "이벤트가 만료되었습니다" });
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

    user.battleState = battleState;
    await saveUser(user);
    res.json({ battleState });
  } catch (err) {
    console.error("Battle start error:", err);
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
    log.push(`${myPokemon.species}이(가) 메가진화했다!`);
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
    log.push(`${myPokemon.species}이(가) 기가맥스했다!`);
  }

  const selectedMove = myMove;
  let selectedMoveData = moveData;

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
    log.push(`${myPokemon.species}이(가) ${preAttack.selfDamage} 데미지를 받았다!`);
    if (await handleFainted(user, myPokemon, battle, log, res)) return;
  }

  // Determine turn order (paralysis speed halving + stat stages applied inside)
  const turnOrder = determineBattleTurnOrder(battle, myPokemon, selectedMoveData, wildMoveData ?? { priority: 0 });

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

  if (turnOrder === "player") {
    if (playerCanAct) {
      recordMoveUsage(myPokemon, selectedMove.id);
      const attackResult = executePlayerAttack(battle, myPokemon, selectedMoveData, selectedMove, log);
      if (battle.wild.hp <= 0) {
        log.push(`야생 ${battle.wild.species}이(가) 쓰러졌다!`);
        user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
        revertBattleForms(battle, myPokemon);
        user.battleState = null;
        await saveUser(user);
        res.json({ log, battleState: null, result: "win" });
        return;
      }
      if (attackResult.flinchCaused) {
        log.push(`야생 ${battle.wild.species}은(는) 풀이 죽어 움직이지 못했다!`);
      } else {
        if (await doWildAttackAndCheck(user, myPokemon, battle, log, res, wildChosenMove ?? undefined)) return;
      }
    } else {
      if (await doWildAttackAndCheck(user, myPokemon, battle, log, res, wildChosenMove ?? undefined)) return;
    }
  } else {
    if (await doWildAttackAndCheck(user, myPokemon, battle, log, res, wildChosenMove ?? undefined)) return;
    if (playerCanAct) {
      recordMoveUsage(myPokemon, selectedMove.id);
      executePlayerAttack(battle, myPokemon, selectedMoveData, selectedMove, log);
      if (battle.wild.hp <= 0) {
        log.push(`야생 ${battle.wild.species}이(가) 쓰러졌다!`);
        user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
        revertBattleForms(battle, myPokemon);
        user.battleState = null;
        await saveUser(user);
        res.json({ log, battleState: null, result: "win" });
        return;
      }
    }
  }

  // End-of-turn: status/volatile ticks, gmax countdown, weather damage
  applyEndOfTurnBattle(battle, myPokemon, log);
  applyWeatherEndOfTurn(battle, myPokemon, log);

  // Check if end-of-turn damage KO'd anyone
  if (myPokemon.hp <= 0) {
    if (await handleFainted(user, myPokemon, battle, log, res)) return;
  }
  if (battle.wild.hp <= 0) {
    log.push(`야생 ${battle.wild.species}이(가) 쓰러졌다!`);
    user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
    revertBattleForms(battle, myPokemon);
    user.battleState = null;
    await saveUser(user);
    res.json({ log, battleState: null, result: "win" });
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
    log.push(`야생 ${battle.wild.species}을(를) 잡았다!`);
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

    user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
    revertBattleForms(battle, myPokemon);
    user.battleState = null;
    await saveUser(user);
    res.json({ log, battleState: null, result: "caught", pokemon: newPokemon });
    return;
  }

  log.push("잡지 못했다...");
  if (await doWildAttackAndCheck(user, myPokemon, battle, log, res)) return;

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

  if (await doWildAttackAndCheck(user, myPokemon, battle, log, res)) return;

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
  battle.playerStatStages = defaultStatStages();
  battle.playerVolatile = [];
  battle.playerBattleForm = undefined; // Reset battle form on switch
  log.push(`${newPokemon.species}(으)로 교체했다!`);

  if (!forced) {
    if (await doWildAttackAndCheck(user, newPokemon, battle, log, res)) return;
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
    console.error("Battle action error:", err);
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
    console.error("Battle state error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
