import { calculateDamage, determineTurnOrder, applyStatChanges, defaultStatStages, applyStatStageMultiplier } from "./battle.js";
import { checkHpThresholdForm, checkWeatherForm, checkPostAttackForm, checkMoveForm, checkPostSurfForm, checkFirstHitForm } from "./battle-forms.js";
import { getTransformedStats, revertGmaxHp } from "./battle-transformations.js";
import { getDefaultWeatherTurns, getWeatherDamage, getWeatherFromMove, getWeatherTypeModifier, tickWeather } from "./weather.js";
import { getMoveById } from "./data-loader.js";
import { getEffectiveTypes } from "./pokemon-state.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles,
  rollAilment, isVolatileAilment, addVolatile, rollSleepTurns, rollConfusionTurns, rollTrapTurns,
} from "./status-conditions.js";
import type { BattleState, MoveData, OwnedPokemon, PrimaryStatus, StatStages, UserData, VolatileStatus } from "../../../../shared/types.js";
import type { Response } from "express";
import { recordDamageTaken } from "./battle-progress.js";
import { saveUser } from "../storage/user-store.js";

export function applyBattleFormChange(
  battle: BattleState,
  result: { newForm: string | null; message: string } | null,
  side: "player" | "wild",
  log: string[],
): void {
  if (!result) return;
  if (side === "player") {
    battle.playerBattleForm = result.newForm;
  } else {
    battle.wildBattleForm = result.newForm;
  }
  const prefix = side === "wild" ? `야생 ${battle.wild.species}: ` : "";
  log.push(`${prefix}${result.message}`);
}

export function maybeSetWeather(
  battle: BattleState,
  moveId: string,
  playerSpecies: string,
  log: string[],
): void {
  const weather = getWeatherFromMove(moveId);
  if (!weather) return;

  battle.weather = weather;
  battle.weatherTurns = getDefaultWeatherTurns();

  const weatherNames: Record<string, string> = {
    sun: "강한 햇살",
    rain: "비",
    hail: "우박",
    sandstorm: "모래바람",
  };
  log.push(`${weatherNames[weather] ?? weather} 상태가 되었다!`);

  applyBattleFormChange(
    battle,
    checkWeatherForm(playerSpecies, battle.weather, battle.playerBattleForm ?? null),
    "player",
    log,
  );
  applyBattleFormChange(
    battle,
    checkWeatherForm(battle.wild.species, battle.weather, battle.wildBattleForm ?? null),
    "wild",
    log,
  );
}

export function applyWeatherEndOfTurn(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  if (!battle.weather) return;

  const playerTypes = getEffectiveTypes(myPokemon.species, myPokemon.variantId, battle.playerBattleForm);
  const wildTypes = getEffectiveTypes(battle.wild.species, battle.wild.variantId, battle.wildBattleForm);

  const playerWeatherDmg = getWeatherDamage(battle.weather, playerTypes, myPokemon.maxHp);
  if (playerWeatherDmg > 0) {
    myPokemon.hp = Math.max(0, myPokemon.hp - playerWeatherDmg);
    log.push(`${myPokemon.species}이(가) 날씨로 ${playerWeatherDmg} 데미지를 받았다!`);
  }

  const wildWeatherDmg = getWeatherDamage(battle.weather, wildTypes, battle.wild.maxHp);
  if (wildWeatherDmg > 0) {
    battle.wild.hp = Math.max(0, battle.wild.hp - wildWeatherDmg);
    log.push(`야생 ${battle.wild.species}이(가) 날씨로 ${wildWeatherDmg} 데미지를 받았다!`);
  }

  const tick = tickWeather(battle.weather, battle.weatherTurns);
  battle.weather = tick.weather;
  battle.weatherTurns = tick.turns;

  if (tick.expired) {
    log.push("날씨가 사라졌다!");
    applyBattleFormChange(
      battle,
      checkWeatherForm(myPokemon.species, undefined, battle.playerBattleForm ?? null),
      "player",
      log,
    );
    applyBattleFormChange(
      battle,
      checkWeatherForm(battle.wild.species, undefined, battle.wildBattleForm ?? null),
      "wild",
      log,
    );
  }
}

export function checkHpForms(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  applyBattleFormChange(
    battle,
    checkHpThresholdForm(
      myPokemon.species,
      myPokemon.hp,
      myPokemon.maxHp,
      myPokemon.level,
      battle.playerBattleForm ?? myPokemon.variantId ?? null,
    ),
    "player",
    log,
  );
  applyBattleFormChange(
    battle,
    checkHpThresholdForm(
      battle.wild.species,
      battle.wild.hp,
      battle.wild.maxHp,
      battle.wild.level,
      battle.wildBattleForm ?? battle.wild.variantId ?? null,
    ),
    "wild",
    log,
  );
}

export function revertBattleForms(
  battle: BattleState,
  myPokemon: OwnedPokemon,
): void {
  if (battle.transformationType === "gigantamax" && battle.playerPreTransformMaxHp != null) {
    const reverted = revertGmaxHp(myPokemon.hp, myPokemon.maxHp, battle.playerPreTransformMaxHp);
    myPokemon.hp = reverted.hp;
    myPokemon.maxHp = reverted.maxHp;
  }

  if (battle.transformationType === "mega" || battle.transformationType === "primal") {
    const originalStats = getTransformedStats(myPokemon, myPokemon.variantId ?? "");
    myPokemon.stats = originalStats.stats;
    myPokemon.maxHp = originalStats.maxHp;
    if (myPokemon.hp > myPokemon.maxHp) {
      myPokemon.hp = myPokemon.maxHp;
    }
  }

  battle.transformationType = null;
  battle.transformationUsed = undefined;
  battle.gmaxTurnsRemaining = undefined;
  battle.playerPreTransformMaxHp = undefined;
  battle.playerBattleForm = undefined;
  battle.wildBattleForm = undefined;
}

// ---------------------------------------------------------------------------
// Helpers shared by executePlayerAttack and battle-routes helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the user's party (excluding the given uid) contains at least
 * one alive pokemon. Used to determine lose vs. fainted outcome.
 */
export function hasAlivePartyMembers(
  user: { party: string[]; pokemon: Array<{ uid: string; hp: number }> },
  excludeUid: string,
): boolean {
  return user.party
    .filter((uid) => uid !== excludeUid)
    .some((uid) => {
      const p = user.pokemon.find((pk) => pk.uid === uid);
      return p != null && p.hp > 0;
    });
}

/** 기술 사용 후 ailment 부여 처리 */
export function maybeApplyAilment(
  moveData: MoveData,
  targetStatus: PrimaryStatus | null | undefined,
  targetVolatiles: VolatileStatus[],
  log: string[],
): { newStatus: PrimaryStatus | null; newVolatiles: VolatileStatus[]; sleepTurns?: number } {
  const ailment = moveData.meta?.ailment;
  const chance = moveData.meta?.ailmentChance ?? 0;
  if (!ailment || ailment === "none") return { newStatus: null, newVolatiles: targetVolatiles };

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

  if (isVolatileAilment(ailment)) {
    if (chance > 0 && chance < 100) {
      if (Math.random() * 100 >= chance) return { newStatus: null, newVolatiles: targetVolatiles };
    }
    let turns = -1;
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

/** meta 효과 적용 (drain, healing) */
export function applyMetaEffects(
  moveData: { meta?: { drain?: number; healing?: number } },
  damage: number,
  _attackerHp: number,
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
      messages.push("체력을 흡수했다!");
    } else if (drainAmount < 0) {
      messages.push("반동 데미지를 받았다!");
    }
  }

  if (meta.healing && meta.healing !== 0) {
    const healAmount = Math.floor(attackerMaxHp * meta.healing / 100);
    hpChange += healAmount;
    if (healAmount > 0) {
      messages.push("체력을 회복했다!");
    }
  }

  return { hpChange, messages };
}

/** stat change 적용 (statChance 확인 포함, move target에 따라 적용 대상 결정) */
export function maybeApplyStatChanges(
  battle: BattleState,
  moveData: { statChanges?: Array<{ stat: string; change: number }>; meta?: { statChance?: number }; target?: string },
  isPlayerMove: boolean,
  log: string[],
): void {
  const changes = moveData.statChanges;
  if (!changes || changes.length === 0) return;
  const chance = moveData.meta?.statChance ?? 100;
  if (Math.random() * 100 >= chance) return;

  const targetsSelf = moveData.target === "user" || moveData.target === "user-and-allies" || moveData.target === "users-field";

  for (const { stat, change } of changes) {
    const isSelfBuff = targetsSelf || change > 0;
    if (isSelfBuff) {
      if (isPlayerMove) {
        battle.playerStatStages = applyStatChanges(battle.playerStatStages ?? defaultStatStages(), [{ stat, change }]);
      } else {
        battle.wildStatStages = applyStatChanges(battle.wildStatStages ?? defaultStatStages(), [{ stat, change }]);
      }
    } else {
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

// ---------------------------------------------------------------------------
// Extracted turn-engine functions
// ---------------------------------------------------------------------------

export interface PlayerAttackResult {
  flinchCaused: boolean;
}

/**
 * Execute the player's attack for this turn.
 * Encapsulates: damage calculation, weather modifier, stat stage application,
 * HP mutation, status/ailment application, form changes, meta effects (drain/healing).
 * Mutates battle and player in place; appends to log.
 */
export function executePlayerAttack(
  battle: BattleState,
  player: OwnedPokemon,
  moveData: MoveData,
  selectedMove: { id: string; pp: number; maxPp: number },
  log: string[],
): PlayerAttackResult {
  selectedMove.pp -= 1;

  // Burn modifier: halve attack for physical moves
  const playerStats = { ...player.stats };
  if (player.statusCondition === "burn") {
    playerStats.attack = Math.max(1, Math.floor(playerStats.attack / 2));
  }

  // Weather type modifier for player attack
  const playerWeatherMod = battle.weather ? getWeatherTypeModifier(battle.weather, moveData.type) : 1;

  const result = calculateDamage(
    player.level, playerStats, battle.wild.stats, moveData,
    getEffectiveTypes(player.species, player.variantId, battle.playerBattleForm),
    getEffectiveTypes(battle.wild.species, battle.wild.variantId, battle.wildBattleForm),
    battle.playerStatStages, battle.wildStatStages,
    playerWeatherMod,
  );
  battle.wild.hp = Math.max(0, battle.wild.hp - result.damage);
  log.push(`${player.species}의 ${moveData.name}! ${result.missed ? "빗나갔다!" : `${result.damage} 데미지!`}`);
  if (result.message) log.push(result.message);

  let flinchCaused = false;

  if (!result.missed) {
    // Apply meta effects for player
    const metaResult = applyMetaEffects(moveData, result.damage, player.hp, player.maxHp);
    if (metaResult.hpChange !== 0) {
      player.hp = Math.max(0, Math.min(player.maxHp, player.hp + metaResult.hpChange));
    }
    for (const msg of metaResult.messages) log.push(msg);

    // Apply stat changes for player
    maybeApplyStatChanges(battle, moveData, true, log);

    // Apply ailment to wild from player attack
    const ailmentResult = maybeApplyAilment(
      moveData,
      battle.wild.statusCondition,
      battle.wildVolatile ?? [],
      log,
    );
    if (ailmentResult.newStatus) {
      battle.wild.statusCondition = ailmentResult.newStatus;
    }
    battle.wildVolatile = ailmentResult.newVolatiles;

    // Check flinch
    const flinchChance = moveData.meta?.flinchChance ?? 0;
    if (flinchChance > 0 && Math.random() * 100 < flinchChance) {
      flinchCaused = true;
    }

    // Player post-attack form check (aegislash)
    applyBattleFormChange(
      battle,
      checkPostAttackForm(player.species, moveData.category, battle.playerBattleForm ?? player.variantId ?? null),
      "player", log,
    );

    // Player move-based form check (meloetta)
    applyBattleFormChange(
      battle,
      checkMoveForm(player.species, selectedMove.id, battle.playerBattleForm ?? player.variantId ?? null),
      "player", log,
    );

    // Player post-surf form (cramorant)
    if (selectedMove.id === "surf" || selectedMove.id === "dive") {
      applyBattleFormChange(
        battle,
        checkPostSurfForm(player.species, player.hp, player.maxHp),
        "player", log,
      );
    }

    // Player weather setting
    maybeSetWeather(battle, selectedMove.id, player.species, log);

    // Check eiscue first-hit for wild (was the wild hit physically?)
    if (moveData.category === "physical" && result.damage > 0) {
      applyBattleFormChange(
        battle,
        checkFirstHitForm(battle.wild.species, battle.wildBattleForm ?? battle.wild.variantId ?? null, true),
        "wild", log,
      );
    }
  }

  // HP threshold form checks after player attack
  checkHpForms(battle, player, log);

  return { flinchCaused };
}

export interface PreAttackResult {
  canAct: boolean;
  selfDamage?: number;
}

/**
 * Pre-attack sleep/status check for the player.
 * Handles sleep turn decrement/wake, and delegates to checkPreAttack for
 * freeze/paralysis/confusion/infatuation checks.
 * Mutates player.statusCondition and player.sleepTurns as needed.
 * Appends messages to log.
 */
export function resolvePreAttack(
  player: OwnedPokemon,
  volatiles: VolatileStatus[],
  log: string[],
): PreAttackResult {
  // Handle sleep turns before the pre-attack check
  if (player.statusCondition === "sleep") {
    if (player.sleepTurns !== undefined && player.sleepTurns > 0) {
      player.sleepTurns -= 1;
    }
    if (player.sleepTurns !== undefined && player.sleepTurns <= 0) {
      player.statusCondition = null;
      player.sleepTurns = undefined;
      log.push(`${player.species}이(가) 잠에서 깨어났다!`);
      return { canAct: true };
    }
  }

  // If no status or volatiles, skip the check
  if (!player.statusCondition && volatiles.length === 0) {
    return { canAct: true };
  }

  const preCheck = checkPreAttack(player.statusCondition, volatiles, player.stats);

  if (preCheck.statusCleared) {
    player.statusCondition = null;
    player.sleepTurns = undefined;
    log.push(preCheck.message);
    return { canAct: true };
  }

  if (!preCheck.canAct) {
    log.push(preCheck.message);
    return { canAct: false, selfDamage: preCheck.selfDamage };
  }

  return { canAct: true };
}

/**
 * Determine which side attacks first this turn.
 * Applies paralysis speed halving and stat stage multipliers before delegating
 * to determineTurnOrder from battle.js.
 */
export function determineBattleTurnOrder(
  battle: BattleState,
  player: OwnedPokemon,
  playerMoveData: { priority?: number },
  wildMoveData: { priority?: number },
): "player" | "wild" {
  let playerSpeedBase = player.stats.speed;
  if (player.statusCondition === "paralysis") {
    playerSpeedBase = Math.max(1, Math.floor(playerSpeedBase / 2));
  }
  let wildSpeedBase = battle.wild.stats.speed;
  if (battle.wild.statusCondition === "paralysis") {
    wildSpeedBase = Math.max(1, Math.floor(wildSpeedBase / 2));
  }

  const playerSpeed = applyStatStageMultiplier(playerSpeedBase, battle.playerStatStages?.speed ?? 0);
  const wildSpeed = applyStatStageMultiplier(wildSpeedBase, battle.wildStatStages?.speed ?? 0);

  return determineTurnOrder(
    playerSpeed, wildSpeed,
    playerMoveData.priority ?? 0, wildMoveData.priority ?? 0,
  );
}

/**
 * Apply all end-of-turn effects:
 * - Status tick damage (poison/burn/trap/leech-seed) for both sides
 * - Gigantamax countdown and revert when it reaches 0
 * - Volatile status tick (decrement turns, remove expired)
 * Mutates battle and player in place; appends to log.
 */
export function applyEndOfTurnBattle(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  // Player end-of-turn status/volatile effects
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

  // Wild end-of-turn status/volatile effects
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

  // Tick volatile statuses
  battle.playerVolatile = tickVolatiles(battle.playerVolatile ?? []);
  battle.wildVolatile = tickVolatiles(battle.wildVolatile ?? []);

  // Gigantamax countdown
  if (battle.transformationType === "gigantamax" && battle.gmaxTurnsRemaining != null) {
    battle.gmaxTurnsRemaining--;
    if (battle.gmaxTurnsRemaining <= 0) {
      battle.playerBattleForm = null;
      battle.transformationType = null;
      const reverted = revertGmaxHp(myPokemon.hp, myPokemon.maxHp, battle.playerPreTransformMaxHp!);
      myPokemon.hp = reverted.hp;
      myPokemon.maxHp = reverted.maxHp;
      battle.playerPreTransformMaxHp = undefined;
      log.push("기가맥스가 풀렸다!");
    }
  }
}

export function wildAttack(
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
  weatherModifier: number = 1,
  wildBattleForm?: string | null,
  targetBattleForm?: string | null,
): { damage: number; moveId: string | null; moveData: MoveData | null; message: string; missed?: boolean; priority?: number } {
  const availableMoves = wildMoves.filter((move) => move.pp > 0);
  if (availableMoves.length === 0) {
    return { damage: 0, moveId: null, moveData: null, message: "야생 포켓몬이 쓸 수 있는 기술이 없다!" };
  }

  const chosen = preSelectedMove ?? availableMoves[Math.floor(Math.random() * availableMoves.length)];
  const moveData = getMoveById(chosen.id) ?? null;
  if (!moveData) {
    return { damage: 0, moveId: chosen.id, moveData: null, message: "" };
  }

  chosen.pp -= 1;

  const result = calculateDamage(
    wildLevel,
    wildStats,
    targetStats,
    moveData,
    getEffectiveTypes(wildSpecies, wildVariantId, wildBattleForm),
    getEffectiveTypes(targetSpecies, targetVariantId, targetBattleForm),
    attackerStages,
    defenderStages,
    weatherModifier,
  );

  return {
    damage: result.damage,
    moveId: chosen.id,
    moveData,
    message: result.message,
    missed: result.missed,
    priority: moveData.priority ?? 0,
  };
}

/** 기절 처리 — response를 보냈으면 true 반환 */
export async function handleFainted(
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
  revertBattleForms(battle, pokemon);
  user.battleState = null;
  await saveUser(user);
  res.json({ log, battleState: null, result: "lose" });
  return true;
}

/** 야생 공격 후 기절 체크 — response를 보냈으면 true 반환 */
export async function doWildAttackAndCheck(
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

  // Weather modifier for wild attack
  const wildMoveData = preSelectedWildMove ? getMoveById(preSelectedWildMove.id) : null;
  const wildWeatherMod = (battle.weather && wildMoveData) ? getWeatherTypeModifier(battle.weather, wildMoveData.type) : 1;

  const wildResult = wildAttack(
    battle.wild.species, battle.wild.level, wildStats,
    battle.wild.moves, myPokemon.stats, myPokemon.species,
    battle.wildStatStages, battle.playerStatStages,
    preSelectedWildMove,
    battle.wild.variantId, myPokemon.variantId,
    wildWeatherMod,
    battle.wildBattleForm, battle.playerBattleForm,
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

    // Wild post-attack form check (aegislash)
    applyBattleFormChange(
      battle,
      checkPostAttackForm(battle.wild.species, wildResult.moveData.category, battle.wildBattleForm ?? battle.wild.variantId ?? null),
      "wild", log,
    );

    // Wild move-based form check (meloetta)
    if (wildResult.moveId) {
      applyBattleFormChange(
        battle,
        checkMoveForm(battle.wild.species, wildResult.moveId, battle.wildBattleForm ?? battle.wild.variantId ?? null),
        "wild", log,
      );
    }

    // Wild post-surf form (cramorant)
    if (wildResult.moveId && (wildResult.moveId === "surf" || wildResult.moveId === "dive")) {
      applyBattleFormChange(
        battle,
        checkPostSurfForm(battle.wild.species, battle.wild.hp, battle.wild.maxHp),
        "wild", log,
      );
    }

    // Wild weather setting
    if (wildResult.moveId) {
      maybeSetWeather(battle, wildResult.moveId, myPokemon.species, log);
    }

    // Check eiscue first-hit for player (was the player hit physically?)
    if (wildResult.moveData.category === "physical" && wildResult.damage > 0) {
      applyBattleFormChange(
        battle,
        checkFirstHitForm(myPokemon.species, battle.playerBattleForm ?? myPokemon.variantId ?? null, true),
        "player", log,
      );
    }
  }

  // HP threshold form checks after wild attack
  checkHpForms(battle, myPokemon, log);

  return await handleFainted(user, myPokemon, battle, log, res);
}
