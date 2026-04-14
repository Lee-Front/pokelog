import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { calculateDamage, determineTurnOrder, applyStatChanges, defaultStatStages, applyStatStageMultiplier } from "../game/battle.js";
import { attemptCapture, getCatchRate } from "../game/capture.js";
import { wildPokemonToOwned } from "../game/pokemon-factory.js";
import { getMoveById, getSpeciesByName, getVariants } from "../game/data-loader.js";
import type { BattleState, MoveData, OwnedPokemon, UserData, StatStages, PrimaryStatus, VolatileStatus } from "../../../../shared/types.js";
import { recordDamageTaken } from "../game/battle-progress.js";
import { decrementItem, healPokemon } from "../game/inventory-utils.js";
import { recordMoveUsage } from "../game/move-usage.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles, rollAilment,
  isVolatileAilment, addVolatile, rollSleepTurns, rollConfusionTurns, rollTrapTurns,
} from "../game/status-conditions.js";

export const battleRoutes = Router();
battleRoutes.use(authMiddleware);

function getTypes(species: string, variantId?: string | null): string[] {
  if (variantId) {
    const variant = getVariants().find(v => v.id === variantId);
    if (variant?.typing) return variant.typing;
  }
  return getSpeciesByName(species)?.types ?? [];
}

function wildAttack(
  wildSpecies: string,
  wildLevel: number,
  wildStats: { attack: number; defense: number; speed: number; spAttack: number; spDefense: number },
  wildMoves: { id: string; pp: number; maxPp: number }[],
  targetStats: { attack: number; defense: number; speed: number; spAttack: number; spDefense: number },
  targetSpecies: string,
  attackerStages?: StatStages,
  defenderStages?: StatStages,
  preSelectedMove?: { id: string; pp: number; maxPp: number },
  wildVariantId?: string | null,
  targetVariantId?: string | null,
) {
  const availableMoves = wildMoves.filter((m) => m.pp > 0);
  if (availableMoves.length === 0) return { damage: 0, moveId: null, moveData: null, message: "야생 포켓몬이 발버둥쳤다!" };

  const chosen = preSelectedMove ?? availableMoves[Math.floor(Math.random() * availableMoves.length)];
  const moveData: MoveData | null = getMoveById(chosen.id) ?? null;
  if (!moveData) return { damage: 0, moveId: chosen.id, moveData: null, message: "" };

  chosen.pp -= 1;

  const result = calculateDamage(
    wildLevel, wildStats, targetStats, moveData,
    getTypes(wildSpecies, wildVariantId), getTypes(targetSpecies, targetVariantId),
    attackerStages, defenderStages,
  );

  return { damage: result.damage, moveId: chosen.id, moveData, message: result.message, missed: result.missed, priority: moveData.priority ?? 0 };
}

function hasAlivePartyMembers(user: { party: string[]; pokemon: Array<{ uid: string; hp: number }> }, excludeUid: string): boolean {
  return user.party
    .filter((uid) => uid !== excludeUid)
    .some((uid) => {
      const p = user.pokemon.find((pk) => pk.uid === uid);
      return p != null && p.hp > 0;
    });
}

/** 기술 사용 후 ailment 부여 처리 */
function maybeApplyAilment(
  moveData: MoveData,
  targetStatus: PrimaryStatus | null | undefined,
  targetVolatiles: VolatileStatus[],
  log: string[],
): { newStatus: PrimaryStatus | null; newVolatiles: VolatileStatus[]; sleepTurns?: number } {
  const ailment = moveData.meta?.ailment;
  const chance = moveData.meta?.ailmentChance ?? 0;
  if (!ailment || ailment === "none") return { newStatus: null, newVolatiles: targetVolatiles };

  // Try primary status
  const primary = rollAilment(ailment, chance, targetStatus);
  if (primary) {
    const statusNames: Record<string, string> = {
      poison: "독", burn: "화상", paralysis: "마비", sleep: "잠듦", freeze: "얼음",
    };
    log.push(`${statusNames[primary] ?? primary} 상태가 되었다!`);
    return {
      newStatus: primary,
      newVolatiles: targetVolatiles,
      sleepTurns: primary === "sleep" ? rollSleepTurns() : undefined,
    };
  }

  // Try volatile status
  if (isVolatileAilment(ailment)) {
    // Roll chance for volatiles too
    if (chance > 0 && chance < 100) {
      if (Math.random() * 100 >= chance) return { newStatus: null, newVolatiles: targetVolatiles };
    }
    let turns = -1; // permanent by default
    if (ailment === "confusion") turns = rollConfusionTurns();
    else if (ailment === "trap") turns = rollTrapTurns();
    else if (ailment === "disable") turns = 4;
    else if (ailment === "embargo") turns = 5;
    else if (ailment === "heal-block") turns = 5;
    else if (ailment === "yawn") turns = 1;
    else if (ailment === "perish-song") turns = 3;

    const newVolatiles = addVolatile(targetVolatiles, ailment, turns);
    if (newVolatiles !== targetVolatiles) {
      const volNames: Record<string, string> = {
        confusion: "혼란", trap: "조이기", "leech-seed": "씨뿌리기", infatuation: "사랑",
      };
      log.push(`${volNames[ailment] ?? ailment} 상태가 되었다!`);
    }
    return { newStatus: null, newVolatiles };
  }

  return { newStatus: null, newVolatiles: targetVolatiles };
}

/** 턴 종료 효과 적용 */
function applyEndOfTurnEffects(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  // Player end-of-turn
  const playerEot = applyEndOfTurn(
    myPokemon.statusCondition,
    battle.playerVolatile ?? [],
    myPokemon.maxHp,
    battle.wild.maxHp,
  );
  if (playerEot.damage > 0) {
    myPokemon.hp = Math.max(0, myPokemon.hp - playerEot.damage);
  }
  if (playerEot.healing > 0) {
    myPokemon.hp = Math.min(myPokemon.maxHp, myPokemon.hp + playerEot.healing);
  }
  if (playerEot.opponentHealing > 0) {
    battle.wild.hp = Math.min(battle.wild.maxHp, battle.wild.hp + playerEot.opponentHealing);
  }
  for (const msg of playerEot.messages) log.push(`${myPokemon.species}: ${msg}`);

  // Wild end-of-turn
  const wildEot = applyEndOfTurn(
    battle.wild.statusCondition,
    battle.wildVolatile ?? [],
    battle.wild.maxHp,
    myPokemon.maxHp,
  );
  if (wildEot.damage > 0) {
    battle.wild.hp = Math.max(0, battle.wild.hp - wildEot.damage);
  }
  if (wildEot.healing > 0) {
    battle.wild.hp = Math.min(battle.wild.maxHp, battle.wild.hp + wildEot.healing);
  }
  if (wildEot.opponentHealing > 0) {
    myPokemon.hp = Math.min(myPokemon.maxHp, myPokemon.hp + wildEot.opponentHealing);
  }
  for (const msg of wildEot.messages) log.push(`야생 ${battle.wild.species}: ${msg}`);

  // Tick volatiles
  battle.playerVolatile = tickVolatiles(battle.playerVolatile ?? []);
  battle.wildVolatile = tickVolatiles(battle.wildVolatile ?? []);
}

/** 기절 처리 — response를 보냈으면 true 반환 */
async function handleFainted(
  user: UserData, pokemon: OwnedPokemon, battle: BattleState,
  log: string[], res: Response,
): Promise<boolean> {
  if (pokemon.hp > 0) return false;
  log.push(`${pokemon.species}이(가) 쓰러졌다!`);
  if (hasAlivePartyMembers(user, pokemon.uid)) {
    await saveUser(user);
    res.json({ log, battleState: battle, result: "fainted" });
    return true;
  }
  user.battleState = null;
  await saveUser(user);
  res.json({ log, battleState: null, result: "lose" });
  return true;
}

/** stat change 적용 (statChance 확인 포함, move target에 따라 적용 대상 결정) */
function maybeApplyStatChanges(
  battle: BattleState,
  moveData: { statChanges?: Array<{ stat: string; change: number }>; meta?: { statChance?: number }; target?: string },
  isPlayerMove: boolean,
  log: string[],
): void {
  const changes = moveData.statChanges;
  if (!changes || changes.length === 0) return;
  const chance = moveData.meta?.statChance ?? 100;
  if (Math.random() * 100 >= chance) return;

  // Determine target: self-targeting moves buff the user, other moves debuff the target
  const targetsSelf = moveData.target === "user" || moveData.target === "user-and-allies" || moveData.target === "users-field";

  for (const { stat, change } of changes) {
    const isSelfBuff = targetsSelf || change > 0;
    // Positive changes (buffs) → apply to move user
    // Negative changes (debuffs) on opponent-targeting moves → apply to defender
    if (isSelfBuff) {
      if (isPlayerMove) {
        battle.playerStatStages = applyStatChanges(battle.playerStatStages ?? defaultStatStages(), [{ stat, change }]);
      } else {
        battle.wildStatStages = applyStatChanges(battle.wildStatStages ?? defaultStatStages(), [{ stat, change }]);
      }
    } else {
      // Debuff applies to the opponent
      if (isPlayerMove) {
        battle.wildStatStages = applyStatChanges(battle.wildStatStages ?? defaultStatStages(), [{ stat, change }]);
      } else {
        battle.playerStatStages = applyStatChanges(battle.playerStatStages ?? defaultStatStages(), [{ stat, change }]);
      }
    }
    const direction = change > 0 ? "올랐다" : "내려갔다";
    log.push(`${stat} 스탯이 ${direction}!`);
  }
}

/** meta 효과 적용 (drain, healing) */
function applyMetaEffects(
  moveData: { meta?: { drain?: number; healing?: number } },
  damage: number,
  attackerHp: number,
  attackerMaxHp: number,
): { hpChange: number; messages: string[] } {
  let hpChange = 0;
  const messages: string[] = [];
  const meta = moveData.meta;
  if (!meta) return { hpChange, messages };

  if (meta.drain && meta.drain !== 0) {
    const drainAmount = Math.floor(damage * meta.drain / 100);
    hpChange += drainAmount;
    if (drainAmount > 0) {
      messages.push(`체력을 흡수했다!`);
    } else if (drainAmount < 0) {
      messages.push(`반동 데미지를 받았다!`);
    }
  }

  if (meta.healing && meta.healing !== 0) {
    const healAmount = Math.floor(attackerMaxHp * meta.healing / 100);
    hpChange += healAmount;
    if (healAmount > 0) {
      messages.push(`체력을 회복했다!`);
    }
  }

  return { hpChange, messages };
}

/** 야생 공격 후 기절 체크 — response를 보냈으면 true 반환 */
async function doWildAttackAndCheck(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  log: string[], res: Response,
  preSelectedWildMove?: { id: string; pp: number; maxPp: number },
): Promise<boolean> {
  // Pre-attack status check for wild pokemon
  const wildPreCheck = checkPreAttack(
    battle.wild.statusCondition,
    battle.wildVolatile ?? [],
    battle.wild.stats,
  );
  if (wildPreCheck.statusCleared) {
    battle.wild.statusCondition = null;
    log.push(`야생 ${battle.wild.species}: ${wildPreCheck.message}`);
  }
  if (!wildPreCheck.canAct) {
    log.push(`야생 ${battle.wild.species}: ${wildPreCheck.message}`);
    if (wildPreCheck.selfDamage) {
      battle.wild.hp = Math.max(0, battle.wild.hp - wildPreCheck.selfDamage);
      log.push(`야생 ${battle.wild.species}이(가) ${wildPreCheck.selfDamage} 데미지를 받았다!`);
    }
    return await handleFainted(user, myPokemon, battle, log, res);
  }

  // Burn modifier: halve attack for physical moves
  const wildStats = { ...battle.wild.stats };
  if (battle.wild.statusCondition === "burn") {
    wildStats.attack = Math.max(1, Math.floor(wildStats.attack / 2));
  }

  const wildResult = wildAttack(
    battle.wild.species, battle.wild.level, wildStats,
    battle.wild.moves, myPokemon.stats, myPokemon.species,
    battle.wildStatStages, battle.playerStatStages,
    preSelectedWildMove,
    battle.wild.variantId, myPokemon.variantId,
  );
  const previousHp = myPokemon.hp;
  myPokemon.hp = Math.max(0, myPokemon.hp - wildResult.damage);
  recordDamageTaken(myPokemon, previousHp - myPokemon.hp);
  log.push(`야생 ${battle.wild.species}의 공격! ${wildResult.damage} 데미지!`);
  if (wildResult.message) log.push(wildResult.message);

  // Apply meta effects for wild pokemon (only if the attack didn't miss)
  if (wildResult.moveData && !wildResult.missed) {
    const metaResult = applyMetaEffects(wildResult.moveData, wildResult.damage, battle.wild.hp, battle.wild.maxHp);
    if (metaResult.hpChange !== 0) {
      battle.wild.hp = Math.max(0, Math.min(battle.wild.maxHp, battle.wild.hp + metaResult.hpChange));
    }
    for (const msg of metaResult.messages) log.push(msg);

    // Apply stat changes for wild pokemon
    maybeApplyStatChanges(battle, wildResult.moveData, false, log);

    // Apply ailment to player from wild attack
    const ailmentResult = maybeApplyAilment(
      wildResult.moveData,
      myPokemon.statusCondition,
      battle.playerVolatile ?? [],
      log,
    );
    if (ailmentResult.newStatus) {
      myPokemon.statusCondition = ailmentResult.newStatus;
      if (ailmentResult.sleepTurns !== undefined) myPokemon.sleepTurns = ailmentResult.sleepTurns;
    }
    battle.playerVolatile = ailmentResult.newVolatiles;
  }

  return await handleFainted(user, myPokemon, battle, log, res);
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
      playerStatStages: defaultStatStages(),
      wildStatStages: defaultStatStages(),
      playerVolatile: [],
      wildVolatile: [],
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

  // Handle sleep turns for player before pre-attack check
  if (myPokemon.statusCondition === "sleep") {
    if (myPokemon.sleepTurns !== undefined && myPokemon.sleepTurns > 0) {
      myPokemon.sleepTurns -= 1;
    }
    if (myPokemon.sleepTurns !== undefined && myPokemon.sleepTurns <= 0) {
      myPokemon.statusCondition = null;
      myPokemon.sleepTurns = undefined;
      log.push(`${myPokemon.species}이(가) 잠에서 깨어났다!`);
    }
  }

  // Pre-attack check for player
  let playerCanAct = true;
  if (myPokemon.statusCondition || (battle.playerVolatile ?? []).length > 0) {
    const preCheck = checkPreAttack(
      myPokemon.statusCondition,
      battle.playerVolatile ?? [],
      myPokemon.stats,
    );
    if (preCheck.statusCleared) {
      myPokemon.statusCondition = null;
      myPokemon.sleepTurns = undefined;
      log.push(preCheck.message);
    }
    if (!preCheck.canAct) {
      playerCanAct = false;
      log.push(preCheck.message);
      if (preCheck.selfDamage) {
        myPokemon.hp = Math.max(0, myPokemon.hp - preCheck.selfDamage);
        log.push(`${myPokemon.species}이(가) ${preCheck.selfDamage} 데미지를 받았다!`);
        if (await handleFainted(user, myPokemon, battle, log, res)) return;
      }
    }
  }

  // Paralysis halves speed
  let playerSpeedBase = myPokemon.stats.speed;
  if (myPokemon.statusCondition === "paralysis") {
    playerSpeedBase = Math.max(1, Math.floor(playerSpeedBase / 2));
  }
  let wildSpeedBase = battle.wild.stats.speed;
  if (battle.wild.statusCondition === "paralysis") {
    wildSpeedBase = Math.max(1, Math.floor(wildSpeedBase / 2));
  }

  const playerSpeed = applyStatStageMultiplier(playerSpeedBase, battle.playerStatStages?.speed ?? 0);
  const wildSpeed = applyStatStageMultiplier(wildSpeedBase, battle.wildStatStages?.speed ?? 0);
  const turnOrder = determineTurnOrder(
    playerSpeed, wildSpeed,
    selectedMoveData.priority ?? 0, wildPriority,
  );

  let playerCausedFlinch = false;

  function playerAttack() {
    selectedMove.pp -= 1;
    recordMoveUsage(myPokemon, selectedMove.id);

    // Burn modifier: halve attack stat for physical moves
    const playerStats = { ...myPokemon.stats };
    if (myPokemon.statusCondition === "burn") {
      playerStats.attack = Math.max(1, Math.floor(playerStats.attack / 2));
    }

    const result = calculateDamage(
      myPokemon.level, playerStats, battle.wild.stats, selectedMoveData,
      getTypes(myPokemon.species, myPokemon.variantId), getTypes(battle.wild.species, battle.wild.variantId),
      battle.playerStatStages, battle.wildStatStages,
    );
    battle.wild.hp = Math.max(0, battle.wild.hp - result.damage);
    log.push(`${myPokemon.species}의 ${selectedMoveData.name}! ${result.missed ? "빗나갔다!" : `${result.damage} 데미지!`}`);
    if (result.message) log.push(result.message);

    if (!result.missed) {
      // Apply meta effects for player
      const metaResult = applyMetaEffects(selectedMoveData, result.damage, myPokemon.hp, myPokemon.maxHp);
      if (metaResult.hpChange !== 0) {
        myPokemon.hp = Math.max(0, Math.min(myPokemon.maxHp, myPokemon.hp + metaResult.hpChange));
      }
      for (const msg of metaResult.messages) log.push(msg);

      // Apply stat changes for player
      maybeApplyStatChanges(battle, selectedMoveData, true, log);

      // Apply ailment to wild from player attack
      const ailmentResult = maybeApplyAilment(
        selectedMoveData,
        battle.wild.statusCondition,
        battle.wildVolatile ?? [],
        log,
      );
      if (ailmentResult.newStatus) {
        battle.wild.statusCondition = ailmentResult.newStatus;
      }
      battle.wildVolatile = ailmentResult.newVolatiles;

      // Check flinch (only effective if player goes first)
      const flinchChance = selectedMoveData.meta?.flinchChance ?? 0;
      if (flinchChance > 0 && Math.random() * 100 < flinchChance) {
        playerCausedFlinch = true;
      }
    }
  }

  if (turnOrder === "player") {
    if (playerCanAct) {
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
    if (playerCausedFlinch) {
      log.push(`야생 ${battle.wild.species}은(는) 풀이 죽어 움직이지 못했다!`);
    } else {
      if (await doWildAttackAndCheck(user, myPokemon, battle, log, res, wildChosenMove ?? undefined)) return;
    }
  } else {
    if (await doWildAttackAndCheck(user, myPokemon, battle, log, res, wildChosenMove ?? undefined)) return;
    if (playerCanAct) {
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
  }

  // End-of-turn effects (status damage, volatile ticks)
  applyEndOfTurnEffects(battle, myPokemon, log);

  // Check if end-of-turn damage KO'd anyone
  if (myPokemon.hp <= 0) {
    if (await handleFainted(user, myPokemon, battle, log, res)) return;
  }
  if (battle.wild.hp <= 0) {
    log.push(`야생 ${battle.wild.species}이(가) 쓰러졌다!`);
    user.pendingEvents = user.pendingEvents.filter((e) => e.id !== battle.eventId);
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

  if (await doWildAttackAndCheck(user, myPokemon, battle, log, res)) return;

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
  battle.playerStatStages = defaultStatStages();
  battle.playerVolatile = [];
  log.push(`${newPokemon.species}(으)로 교체했다!`);

  if (!forced) {
    if (await doWildAttackAndCheck(user, newPokemon, battle, log, res)) return;
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
