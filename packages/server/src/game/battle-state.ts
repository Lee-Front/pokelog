import { calculateDamage, determineTurnOrder, applyStatChanges, defaultStatStages, applyStatStageMultiplier } from "./battle.js";
import { checkHpThresholdForm, checkWeatherForm, checkPostAttackForm, checkMoveForm, checkPostSurfForm, checkFirstHitForm } from "./battle-forms.js";
import { getTransformedStats, revertGmaxHp } from "./battle-transformations.js";
import { getDefaultWeatherTurns, getWeatherDamage, getWeatherFromMove, getWeatherTypeModifier, tickWeather } from "./weather.js";
import {
  getDefaultTerrainTurns, getTerrainFromMove, getTerrainTypeModifier, getTerrainHeal,
  terrainBlocksStatus, isGrounded, tickTerrain,
} from "./terrain.js";
import { getMoveById } from "./data-loader.js";
import { getEffectiveTypes, getDisplaySpeciesName } from "./pokemon-state.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles,
  rollAilment, isVolatileAilment, addVolatile, rollSleepTurns, rollConfusionTurns, rollTrapTurns,
} from "./status-conditions.js";
import type { BattleState, MoveData, OwnedPokemon, PrimaryStatus, StatStages, UserData, VolatileStatus } from "../../../../shared/types.js";
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
  const prefix = side === "wild" ? `야생 ${getDisplaySpeciesName(battle.wild.species)}: ` : "";
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

export function maybeSetTerrain(
  battle: BattleState,
  moveId: string,
  log: string[],
): void {
  const terrain = getTerrainFromMove(moveId);
  if (!terrain) return;

  battle.terrain = terrain;
  battle.terrainTurns = getDefaultTerrainTurns();

  const terrainNames: Record<string, string> = {
    electric: "일렉트릭필드",
    grassy: "그래스필드",
    misty: "미스트필드",
    psychic: "사이코필드",
  };
  log.push(`발밑에 ${terrainNames[terrain] ?? terrain}가 깔렸다!`);
}

export function applyTerrainEndOfTurn(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  if (!battle.terrain) return;

  const playerTypes = getEffectiveTypes(myPokemon.species, myPokemon.variantId, battle.playerBattleForm);
  const wildTypes = getEffectiveTypes(battle.wild.species, battle.wild.variantId, battle.wildBattleForm);

  // 그래스필드: 접지한 양측을 1/16 회복
  const playerHeal = getTerrainHeal(battle.terrain, playerTypes, myPokemon.maxHp);
  if (playerHeal > 0 && myPokemon.hp > 0) {
    myPokemon.hp = Math.min(myPokemon.maxHp, myPokemon.hp + playerHeal);
    log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) 필드로 ${playerHeal} 회복했다!`);
  }

  const wildHeal = getTerrainHeal(battle.terrain, wildTypes, battle.wild.maxHp);
  if (wildHeal > 0 && battle.wild.hp > 0) {
    battle.wild.hp = Math.min(battle.wild.maxHp, battle.wild.hp + wildHeal);
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}이(가) 필드로 ${wildHeal} 회복했다!`);
  }

  const tick = tickTerrain(battle.terrain, battle.terrainTurns);
  battle.terrain = tick.terrain;
  battle.terrainTurns = tick.turns;

  if (tick.expired) {
    log.push("필드가 사라졌다!");
  }
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
    log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) 날씨로 ${playerWeatherDmg} 데미지를 받았다!`);
  }

  const wildWeatherDmg = getWeatherDamage(battle.weather, wildTypes, battle.wild.maxHp);
  if (wildWeatherDmg > 0) {
    battle.wild.hp = Math.max(0, battle.wild.hp - wildWeatherDmg);
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}이(가) 날씨로 ${wildWeatherDmg} 데미지를 받았다!`);
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
  battle?: BattleState,
  targetTypes?: string[],
): { newStatus: PrimaryStatus | null; newVolatiles: VolatileStatus[]; sleepTurns?: number } {
  const ailment = moveData.meta?.ailment;
  const chance = moveData.meta?.ailmentChance ?? 0;
  if (!ailment || ailment === "none") return { newStatus: null, newVolatiles: targetVolatiles };

  const primary = rollAilment(ailment, chance, targetStatus);
  if (primary) {
    // 필드가 상태이상을 막는지: 일렉트릭(접지 대상 sleep 차단)/미스트(접지 대상 5대 상태이상 차단)
    if (
      battle?.terrain && targetTypes &&
      terrainBlocksStatus(battle.terrain, primary, isGrounded(targetTypes))
    ) {
      log.push("필드가 상태이상을 막았다!");
      return { newStatus: null, newVolatiles: targetVolatiles };
    }
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
      // "skip if over": roll >= chance means the effect does NOT apply
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
  // "skip if over": roll >= chance means stat changes do NOT apply
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

  // 공격자(플레이어)/대상(야생) 타입 — 날씨·필드·상태이상 게이팅에 재사용
  const playerAtkTypes = getEffectiveTypes(player.species, player.variantId, battle.playerBattleForm);
  const wildDefTypes = getEffectiveTypes(battle.wild.species, battle.wild.variantId, battle.wildBattleForm);

  // Weather type modifier for player attack
  const playerWeatherMod = battle.weather ? getWeatherTypeModifier(battle.weather, moveData.type) : 1;
  // Terrain type modifier for player attack (공격자 접지 여부, 대상 접지 여부 기준)
  const playerTerrainMod = battle.terrain
    ? getTerrainTypeModifier(battle.terrain, moveData.type, isGrounded(playerAtkTypes), isGrounded(wildDefTypes))
    : 1;

  const result = calculateDamage(
    player.level, playerStats, battle.wild.stats, moveData,
    playerAtkTypes,
    wildDefTypes,
    battle.playerStatStages, battle.wildStatStages,
    playerWeatherMod * playerTerrainMod,
  );
  battle.wild.hp = Math.max(0, battle.wild.hp - result.damage);
  log.push(`${getDisplaySpeciesName(player.species)}의 ${moveData.name}! ${result.missed ? "빗나갔다!" : `${result.damage} 데미지!`}`);
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

    // Apply ailment to wild from player attack (필드 상태이상 차단 게이팅 포함)
    const ailmentResult = maybeApplyAilment(
      moveData,
      battle.wild.statusCondition,
      battle.wildVolatile ?? [],
      log,
      battle,
      wildDefTypes,
    );
    if (ailmentResult.newStatus) {
      battle.wild.statusCondition = ailmentResult.newStatus;
    }
    battle.wildVolatile = ailmentResult.newVolatiles;

    // Check flinch
    // "apply if under": roll < chance means flinch IS applied
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

    // Player terrain setting
    maybeSetTerrain(battle, selectedMove.id, log);

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
      log.push(`${getDisplaySpeciesName(player.species)}이(가) 잠에서 깨어났다!`);
      return { canAct: true };
    }
  }

  // If no status or volatiles, skip the check
  if (!player.statusCondition && volatiles.length === 0) {
    return { canAct: true };
  }

  const preCheck = checkPreAttack(player.statusCondition, volatiles, player.stats, player.level);

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
  for (const msg of playerEot.messages) log.push(`${getDisplaySpeciesName(myPokemon.species)}: ${msg}`);

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
  for (const msg of wildEot.messages) log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}: ${msg}`);

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

export interface FaintedResult {
  fainted: true;
  gameOver: boolean;
  log: string[];
  battleState: BattleState | null;
  result: "fainted" | "lose";
}

/** 기절 처리 — 기절하지 않았으면 null 반환 */
export async function handleFainted(
  user: UserData, pokemon: OwnedPokemon, battle: BattleState,
  log: string[],
): Promise<FaintedResult | null> {
  if (pokemon.hp > 0) return null;
  log.push(`${getDisplaySpeciesName(pokemon.species)}이(가) 쓰러졌다!`);
  if (hasAlivePartyMembers(user, pokemon.uid)) {
    await saveUser(user);
    return { fainted: true, gameOver: false, log, battleState: battle, result: "fainted" };
  }
  revertBattleForms(battle, pokemon);
  user.battleState = null;
  await saveUser(user);
  return { fainted: true, gameOver: true, log, battleState: null, result: "lose" };
}

/** 야생 공격 후 기절 체크 — 기절 결과가 있으면 FaintedResult 반환, 없으면 null */
export async function doWildAttackAndCheck(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState,
  log: string[],
  preSelectedWildMove?: { id: string; pp: number; maxPp: number },
): Promise<FaintedResult | null> {
  // Pre-attack status check for wild pokemon
  const wildPreCheck = checkPreAttack(
    battle.wild.statusCondition,
    battle.wildVolatile ?? [],
    battle.wild.stats,
    battle.wild.level,
  );
  if (wildPreCheck.statusCleared) {
    battle.wild.statusCondition = null;
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}: ${wildPreCheck.message}`);
  }
  if (!wildPreCheck.canAct) {
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}: ${wildPreCheck.message}`);
    if (wildPreCheck.selfDamage) {
      battle.wild.hp = Math.max(0, battle.wild.hp - wildPreCheck.selfDamage);
      log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}이(가) ${wildPreCheck.selfDamage} 데미지를 받았다!`);
    }
    return await handleFainted(user, myPokemon, battle, log);
  }

  // Burn modifier: halve attack for physical moves
  const wildStats = { ...battle.wild.stats };
  if (battle.wild.statusCondition === "burn") {
    wildStats.attack = Math.max(1, Math.floor(wildStats.attack / 2));
  }

  // 공격자(야생)/대상(플레이어) 타입 — 날씨·필드·상태이상 게이팅에 재사용
  const wildAtkTypes = getEffectiveTypes(battle.wild.species, battle.wild.variantId, battle.wildBattleForm);
  const playerDefTypes = getEffectiveTypes(myPokemon.species, myPokemon.variantId, battle.playerBattleForm);

  // Weather modifier for wild attack
  const wildMoveData = preSelectedWildMove ? getMoveById(preSelectedWildMove.id) : null;
  const wildWeatherMod = (battle.weather && wildMoveData) ? getWeatherTypeModifier(battle.weather, wildMoveData.type) : 1;
  // Terrain modifier for wild attack (공격자 접지 여부, 대상 접지 여부 기준)
  const wildTerrainMod = (battle.terrain && wildMoveData)
    ? getTerrainTypeModifier(battle.terrain, wildMoveData.type, isGrounded(wildAtkTypes), isGrounded(playerDefTypes))
    : 1;

  const wildResult = wildAttack(
    battle.wild.species, battle.wild.level, wildStats,
    battle.wild.moves, myPokemon.stats, myPokemon.species,
    battle.wildStatStages, battle.playerStatStages,
    preSelectedWildMove,
    battle.wild.variantId, myPokemon.variantId,
    wildWeatherMod * wildTerrainMod,
    battle.wildBattleForm, battle.playerBattleForm,
  );
  const previousHp = myPokemon.hp;
  myPokemon.hp = Math.max(0, myPokemon.hp - wildResult.damage);
  recordDamageTaken(myPokemon, previousHp - myPokemon.hp);
  log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}의 공격! ${wildResult.damage} 데미지!`);
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

    // Apply ailment to player from wild attack (필드 상태이상 차단 게이팅 포함)
    const ailmentResult = maybeApplyAilment(
      wildResult.moveData,
      myPokemon.statusCondition,
      battle.playerVolatile ?? [],
      log,
      battle,
      playerDefTypes,
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

    // Wild terrain setting
    if (wildResult.moveId) {
      maybeSetTerrain(battle, wildResult.moveId, log);
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

  return await handleFainted(user, myPokemon, battle, log);
}
