import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { calculateDamage, determineTurnOrder } from "../game/battle.js";
import { attemptCapture, getCatchRate } from "../game/capture.js";
import { createPokemon } from "../game/pokemon-factory.js";
import { getMoveById, getSpeciesByName } from "../game/data-loader.js";
import type { BattleState, OwnedPokemon, UserData } from "../../../../shared/types.js";
import { recordDamageTaken } from "../game/battle-progress.js";
import { decrementItem, healPokemon } from "../game/inventory-utils.js";
import { recordMoveUsage } from "../game/move-usage.js";

export const battleRoutes = Router();
battleRoutes.use(authMiddleware);

function getTypes(species: string): string[] {
  return getSpeciesByName(species)?.types ?? [];
}

function wildAttack(
  wildSpecies: string,
  wildLevel: number,
  wildStats: { attack: number; defense: number; speed: number; spAttack: number; spDefense: number },
  wildMoves: { id: string; pp: number; maxPp: number }[],
  targetStats: { attack: number; defense: number; speed: number; spAttack: number; spDefense: number },
  targetSpecies: string,
) {
  const availableMoves = wildMoves.filter((m) => m.pp > 0);
  if (availableMoves.length === 0) return { damage: 0, moveId: null, message: "야생 포켓몬이 발버둥쳤다!" };

  const chosen = availableMoves[Math.floor(Math.random() * availableMoves.length)];
  const moveData = getMoveById(chosen.id);
  if (!moveData) return { damage: 0, moveId: chosen.id, message: "" };

  chosen.pp -= 1;

  const result = calculateDamage(
    wildLevel, wildStats, targetStats, moveData,
    getTypes(wildSpecies), getTypes(targetSpecies),
  );

  return { damage: result.damage, moveId: chosen.id, message: result.message, missed: result.missed, priority: moveData.priority ?? 0 };
}

function hasAlivePartyMembers(user: { party: string[]; pokemon: Array<{ uid: string; hp: number }> }, excludeUid: string): boolean {
  return user.party
    .filter((uid) => uid !== excludeUid)
    .some((uid) => {
      const p = user.pokemon.find((pk) => pk.uid === uid);
      return p != null && p.hp > 0;
    });
}

/** 기절 처리 — response를 보냈으면 true 반환 */
function handleFainted(
  user: UserData, pokemon: OwnedPokemon, battle: BattleState,
  log: string[], res: Response,
): boolean {
  if (pokemon.hp > 0) return false;
  log.push(`${pokemon.species}이(가) 쓰러졌다!`);
  if (hasAlivePartyMembers(user, pokemon.uid)) {
    saveUser(user);
    res.json({ log, battleState: battle, result: "fainted" });
    return true;
  }
  user.battleState = null;
  saveUser(user);
  res.json({ log, battleState: null, result: "lose" });
  return true;
}

/** 야생 공격 후 기절 체크 — response를 보냈으면 true 반환 */
function doWildAttackAndCheck(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  log: string[], res: Response,
): boolean {
  const wildResult = wildAttack(
    battle.wild.species, battle.wild.level, battle.wild.stats,
    battle.wild.moves, myPokemon.stats, myPokemon.species,
  );
  const previousHp = myPokemon.hp;
  myPokemon.hp = Math.max(0, myPokemon.hp - wildResult.damage);
  recordDamageTaken(myPokemon, previousHp - myPokemon.hp);
  log.push(`야생 ${battle.wild.species}의 공격! ${wildResult.damage} 데미지!`);
  if (wildResult.message) log.push(wildResult.message);
  return handleFainted(user, myPokemon, battle, log, res);
}

battleRoutes.post("/start", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { eventId, pokemonUid } = req.body;

    if (!eventId || !pokemonUid) {
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
    };

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
  const moveId = data?.moveId as string | undefined;
  if (!moveId) { res.status(400).json({ error: "사용할 기술을 선택해주세요" }); return; }

  const myMove = myPokemon.moves.find((m) => m.id === moveId);
  if (!myMove || myMove.pp <= 0) { res.status(400).json({ error: "사용할 수 없는 기술입니다" }); return; }

  const moveData = getMoveById(moveId);
  if (!moveData) { res.status(400).json({ error: "기술 데이터를 찾을 수 없습니다" }); return; }

  const selectedMove = myMove;
  const selectedMoveData = moveData;

  // Pre-select wild move to get its priority for turn order
  const wildAvailableMoves = battle.wild.moves.filter((m) => m.pp > 0);
  const wildChosenMove = wildAvailableMoves.length > 0
    ? wildAvailableMoves[Math.floor(Math.random() * wildAvailableMoves.length)]
    : null;
  const wildMoveData = wildChosenMove ? getMoveById(wildChosenMove.id) : null;
  const wildPriority = wildMoveData?.priority ?? 0;

  const turnOrder = determineTurnOrder(
    myPokemon.stats.speed, battle.wild.stats.speed,
    selectedMoveData.priority ?? 0, wildPriority,
  );

  function playerAttack() {
    selectedMove.pp -= 1;
    recordMoveUsage(myPokemon, selectedMove.id);
    const result = calculateDamage(
      myPokemon.level, myPokemon.stats, battle.wild.stats, selectedMoveData,
      getTypes(myPokemon.species), getTypes(battle.wild.species),
    );
    battle.wild.hp = Math.max(0, battle.wild.hp - result.damage);
    log.push(`${myPokemon.species}의 ${selectedMoveData.name}! ${result.missed ? "빗나갔다!" : `${result.damage} 데미지!`}`);
    if (result.message) log.push(result.message);
  }

  if (turnOrder === "player") {
    playerAttack();
    if (battle.wild.hp <= 0) {
      log.push(`야생 ${battle.wild.species}이(가) 쓰러졌다!`);
      user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
      user.battleState = null;
      await saveUser(user);
      res.json({ log, battleState: null, result: "win" });
      return;
    }
    if (doWildAttackAndCheck(user, myPokemon, battle, log, res)) return;
  } else {
    if (doWildAttackAndCheck(user, myPokemon, battle, log, res)) return;
    playerAttack();
    if (battle.wild.hp <= 0) {
      log.push(`야생 ${battle.wild.species}이(가) 쓰러졌다!`);
      user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
      user.battleState = null;
      await saveUser(user);
      res.json({ log, battleState: null, result: "win" });
      return;
    }
  }

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleCatch(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
) {
  const ballType = (data?.ball as string) || "pokeball";

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
    const newPokemon = createPokemon(battle.wild.species, battle.wild.level);
    newPokemon.hp = battle.wild.hp;

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
    user.battleState = null;
    await saveUser(user);
    res.json({ log, battleState: null, result: "caught", pokemon: newPokemon });
    return;
  }

  log.push("잡지 못했다...");
  if (doWildAttackAndCheck(user, myPokemon, battle, log, res)) return;

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleItem(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
) {
  const itemId = data?.item as string | undefined;
  const targetUid = (data?.pokemonUid as string) || battle.myPokemonUid;

  if (!itemId) { res.status(400).json({ error: "사용할 아이템을 선택해주세요" }); return; }

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

  if (doWildAttackAndCheck(user, myPokemon, battle, log, res)) return;

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleSwitch(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  data: Record<string, unknown>, log: string[], res: Response,
) {
  const newUid = data?.pokemonUid as string | undefined;
  if (!newUid) { res.status(400).json({ error: "교체할 포켓몬을 선택해주세요" }); return; }

  const newPokemon = user.pokemon.find((p) => p.uid === newUid);
  if (!newPokemon) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" }); return; }

  if (newPokemon.hp <= 0) {
    res.status(400).json({ error: "기절한 포켓몬으로 교체할 수 없습니다" });
    return;
  }

  const forced = data?.forced === true;
  battle.myPokemonUid = newUid;
  log.push(`${newPokemon.species}(으)로 교체했다!`);

  if (!forced) {
    if (doWildAttackAndCheck(user, newPokemon, battle, log, res)) return;
  }

  await saveUser(user);
  res.json({ log, battleState: battle, result: "continue" });
}

async function handleRun(
  user: UserData, battle: BattleState, log: string[], res: Response,
) {
  log.push("무사히 도망쳤다!");
  user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
  user.battleState = null;
  await saveUser(user);
  res.json({ log, battleState: null, result: "run" });
}

battleRoutes.post("/action", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { action, data } = req.body;

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
      case "run":    await handleRun(user, battle, log, res); break;
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
