import { calculateDamage, determineTurnOrder, applyStatChanges, defaultStatStages, applyStatStageMultiplier } from "./battle.js";
import { checkHpThresholdForm, checkWeatherForm, checkPostAttackForm, checkMoveForm, checkPostSurfForm, checkFirstHitForm } from "./battle-forms.js";
import { getTransformedStats, revertGmaxHp } from "./battle-transformations.js";
import { getDefaultWeatherTurns, getWeatherDamage, getWeatherFromMove, getWeatherTypeModifier, tickWeather } from "./weather.js";
import {
  getDefaultTerrainTurns, getTerrainFromMove, getTerrainTypeModifier, getTerrainHeal,
  terrainBlocksStatus, isGrounded, tickTerrain,
} from "./terrain.js";
import { getMoveById } from "./data-loader.js";
import {
  getHeldOffenseMultiplier, getHeldSpDefMultiplier, applyLifeOrbRecoil,
  tryFocusSurvive, applyHeldEndOfTurnHeal, maybeConsumePinchBerry, quickClawTriggers,
} from "./held-item-battle.js";
import { getEffectiveTypes, getDisplaySpeciesName } from "./pokemon-state.js";
import {
  hasAbility, getAbilityOffenseMultiplier, checkAbilityImmunity,
  getAbilityDefenseMultiplier, applyContactAbilities, applyEndOfTurnAbilities,
  getAbilitySpeedMultiplier, abilitySurvivesKO, applySwitchInAbilities,
  abilityBlocksStatus, attackerBreaksMold, abilityNullifiesNonSuperEffective,
  abilityBlocksIndirectDamage, resolveUnawareStages, applyContraryToChange,
  checkDisguiseBreak, isIronFistMove,
  type OffenseContext, type AbilityHolder,
} from "./abilities.js";
import {
  checkPreAttack, applyEndOfTurn, tickVolatiles, hasVolatile,
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

  // 매직가드는 날씨 도트(모래바람/우박)도 무효로 한다.
  const playerWeatherDmg = abilityBlocksIndirectDamage(myPokemon) ? 0 : getWeatherDamage(battle.weather, playerTypes, myPokemon.maxHp);
  if (playerWeatherDmg > 0) {
    myPokemon.hp = Math.max(0, myPokemon.hp - playerWeatherDmg);
    log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) 날씨로 ${playerWeatherDmg} 데미지를 받았다!`);
  }

  const wildWeatherDmg = abilityBlocksIndirectDamage(battle.wild) ? 0 : getWeatherDamage(battle.weather, wildTypes, battle.wild.maxHp);
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
  targetAbilityHolder?: { abilityId?: string | null; ability?: string | null },
): { newStatus: PrimaryStatus | null; newVolatiles: VolatileStatus[]; sleepTurns?: number } {
  const ailment = moveData.meta?.ailment;
  const chance = moveData.meta?.ailmentChance ?? 0;
  if (!ailment || ailment === "none") return { newStatus: null, newVolatiles: targetVolatiles };

  const primary = rollAilment(ailment, chance, targetStatus);
  if (primary) {
    // 특성 상태이상 면역(limber·immunity·insomnia 등): 부여 직전 차단.
    if (targetAbilityHolder && abilityBlocksStatus(targetAbilityHolder, primary)) {
      log.push("특성으로 상태이상을 막았다!");
      return { newStatus: null, newVolatiles: targetVolatiles };
    }
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

/**
 * stat change 적용 (statChance 확인 포함, move target에 따라 적용 대상 결정).
 * holders를 주면 심술꾸러기(contrary) 보유자에게 적용되는 랭크 변화의 부호를 반전한다.
 * holders 미제공(레거시/테스트 호출)이면 contrary는 발동하지 않고 종전과 동일하다.
 */
export function maybeApplyStatChanges(
  battle: BattleState,
  moveData: { statChanges?: Array<{ stat: string; change: number }>; meta?: { statChance?: number }; target?: string },
  isPlayerMove: boolean,
  log: string[],
  holders?: { player?: AbilityHolder | null; wild?: AbilityHolder | null },
): void {
  const changes = moveData.statChanges;
  if (!changes || changes.length === 0) return;
  const chance = moveData.meta?.statChance ?? 100;
  // "skip if over": roll >= chance means stat changes do NOT apply
  if (Math.random() * 100 >= chance) return;

  const targetsSelf = moveData.target === "user" || moveData.target === "user-and-allies" || moveData.target === "users-field";

  for (const { stat, change } of changes) {
    const isSelfBuff = targetsSelf || change > 0;
    // 이 변화를 실제로 받는 쪽을 먼저 결정한다(자기 강화면 사용자, 아니면 상대).
    const recipientIsPlayer = isSelfBuff ? isPlayerMove : !isPlayerMove;
    // 심술꾸러기: 수령자가 contrary면 부호 반전(로그 방향도 반전 후 값 기준).
    const recipientHolder = recipientIsPlayer ? holders?.player : holders?.wild;
    const effectiveChange = recipientHolder ? applyContraryToChange(recipientHolder, change) : change;

    if (recipientIsPlayer) {
      battle.playerStatStages = applyStatChanges(battle.playerStatStages ?? defaultStatStages(), [{ stat, change: effectiveChange }]);
    } else {
      battle.wildStatStages = applyStatChanges(battle.wildStatStages ?? defaultStatStages(), [{ stat, change: effectiveChange }]);
    }
    const direction = effectiveChange > 0 ? "올랐다" : "내려갔다";
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
 * 기술 메타에서 "부가효과(secondary)" 보유 여부를 판정한다(sheer-force 게이팅).
 * 상태이상/추가 스탯변화/풀죽음 확률 중 하나라도 있으면 부가효과가 있는 것으로 본다.
 */
function moveHasSecondary(moveData: MoveData): boolean {
  const meta = moveData.meta;
  const hasAilment = !!meta?.ailment && meta.ailment !== "none" && (meta.ailmentChance ?? 0) > 0;
  const hasStatChance = (meta?.statChance ?? 0) > 0 && (moveData.statChanges?.length ?? 0) > 0;
  const hasFlinch = (meta?.flinchChance ?? 0) > 0;
  return hasAilment || hasStatChance || hasFlinch;
}

/**
 * calculateDamage 결과와 기술 메타로부터 조건부 공격 특성(OffenseContext)을 구성한다.
 * moveId·moveData·데미지 결과(효과/급소)와 현재 날씨를 종합한다.
 */
function buildOffenseContext(
  moveId: string,
  moveData: MoveData,
  effectiveness: number,
  critical: boolean,
  weather: import("../../../../shared/types.js").BattleWeather | undefined,
): OffenseContext {
  return {
    isSuperEffective: effectiveness > 1,
    notVeryEffective: effectiveness > 0 && effectiveness < 1,
    isCritical: critical,
    hasSecondary: moveHasSecondary(moveData),
    isRecoilMove: (moveData.meta?.drain ?? 0) < 0,
    isPunchMove: isIronFistMove(moveId),
    isContact: moveData.category === "physical",
    weather,
  };
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

  // 틀깨기(mold-breaker/turboblaze/teravolt): 플레이어가 이 특성이면 야생의 방어 특성을 무시.
  const playerBreaksMold = attackerBreaksMold(player);

  // 특성 방어 면역/흡수(volt-absorb·levitate 등): 데미지 적용 전 판정.
  // 면역이면 데미지 0, 2차효과/접촉/풀죽음을 모두 스킵하고 heal/boost만 적용.
  // status 기술이거나 무특성/미지원이면 immune=false라 종전과 동일하게 진행한다.
  if (moveData.category !== "status") {
    const immunity = checkAbilityImmunity(battle.wild, moveData.type, moveData.category, playerBreaksMold);
    if (immunity.immune) {
      // pp는 이미 위에서 차감됨(빗나감과 동일하게 소모).
      log.push(`${getDisplaySpeciesName(battle.wild.species)}에게는 효과가 없는 것 같다...`);
      if (immunity.healFraction) {
        const heal = Math.max(1, Math.floor(battle.wild.maxHp * immunity.healFraction));
        if (battle.wild.hp > 0 && battle.wild.hp < battle.wild.maxHp) {
          battle.wild.hp = Math.min(battle.wild.maxHp, battle.wild.hp + heal);
          log.push(`${getDisplaySpeciesName(battle.wild.species)}이(가) ${heal} 회복했다!`);
        }
      }
      if (immunity.boostStat) {
        battle.wildStatStages = applyStatChanges(battle.wildStatStages ?? defaultStatStages(), [{ stat: immunity.boostStat, change: 1 }]);
        log.push(`${getDisplaySpeciesName(battle.wild.species)}의 능력이 올랐다!`);
      }
      checkHpForms(battle, player, log);
      return { flinchCaused: false };
    }
  }

  // Weather type modifier for player attack
  const playerWeatherMod = battle.weather ? getWeatherTypeModifier(battle.weather, moveData.type) : 1;
  // Terrain type modifier for player attack (공격자 접지 여부, 대상 접지 여부 기준)
  const playerTerrainMod = battle.terrain
    ? getTerrainTypeModifier(battle.terrain, moveData.type, isGrounded(playerAtkTypes), isGrounded(wildDefTypes))
    : 1;

  // 지닌물건 방어 보정: 야생이 돌격조끼 보유 시 특수 데미지 ÷1.5 (def×1.5 등가)
  const wildSpDefMod = getHeldSpDefMultiplier(battle.wild, moveData.category);

  // 테라스탈 STAB: 플레이어가 terastallize했으면 teraType + 원래 타입(playerAtkTypes)을 넘겨
  // 본가식 STAB(2.0/1.5/1.0)을 계산하게 한다. 미발동이면 undefined → 종전과 동일.
  const playerTeraStab = (battle.playerTerastallized && battle.playerTeraType)
    ? { teraType: battle.playerTeraType, originalTypes: playerAtkTypes }
    : undefined;

  // 배짱없음(unaware): 공격자(플레이어)가 unaware면 야생 방어 랭크 무시, 야생이 unaware면
  // 플레이어 공격 랭크 무시. 해당 특성이 없으면 원본 참조 그대로(byte-identical).
  const playerUnaware = resolveUnawareStages(player, battle.wild, battle.playerStatStages, battle.wildStatStages);

  const result = calculateDamage(
    player.level, playerStats, battle.wild.stats, moveData,
    playerAtkTypes,
    wildDefTypes,
    playerUnaware.attackerStages, playerUnaware.defenderStages,
    (playerWeatherMod * playerTerrainMod) / wildSpDefMod,
    playerTeraStab,
  );

  // 지닌물건 공격 보정: 생명의구슬/힘의머리띠/박식안경/달인의띠
  const playerOffenseMod = getHeldOffenseMultiplier(player, moveData.category, result.effectiveness > 1);
  if (playerOffenseMod !== 1 && result.damage > 0) {
    result.damage = Math.floor(result.damage * playerOffenseMod);
  }

  // 특성 공격 보정(overgrow·technician·huge-power·guts·adaptability + 조건부 sheer-force 등).
  const playerAbilityOffenseMod = getAbilityOffenseMultiplier(
    player, moveData.type, moveData.category, moveData.power,
    player.maxHp > 0 ? player.hp / player.maxHp : 0,
    playerAtkTypes.includes(moveData.type),
    player.statusCondition != null,
    buildOffenseContext(selectedMove.id, moveData, result.effectiveness, result.critical, battle.weather),
  );
  if (playerAbilityOffenseMod !== 1 && result.damage > 0) {
    result.damage = Math.floor(result.damage * playerAbilityOffenseMod);
  }

  // 특성 방어 보정(thick-fat·multiscale·filter 등) — 야생 방어자 기준. 틀깨기면 무시.
  const wildAbilityDefenseMod = getAbilityDefenseMultiplier(
    battle.wild, moveData.type,
    battle.wild.maxHp > 0 ? battle.wild.hp / battle.wild.maxHp : 0,
    result.effectiveness > 1,
    playerBreaksMold,
  );
  if (wildAbilityDefenseMod !== 1 && result.damage > 0) {
    result.damage = Math.floor(result.damage * wildAbilityDefenseMod);
  }

  // 원더가드(야생 방어자): 효과가 굉장하지 않은 데미지 기술은 데미지 0. 틀깨기면 무시.
  // 데미지가 0이 되면 아래 result.damage>0 게이트가 접촉/생명의구슬/2차 효과를 자동 스킵하고,
  // hitSuppressed가 상태이상/스탯변화(비-데미지 게이트) 부여도 스킵한다.
  const wildWonderGuardBlocks = abilityNullifiesNonSuperEffective(battle.wild, moveData.category, result.effectiveness > 1, playerBreaksMold);
  let hitSuppressed = false;
  if (wildWonderGuardBlocks && result.damage > 0) {
    result.damage = 0;
    hitSuppressed = true;
  }

  // 탈(disguise, 야생 방어자): 아직 탈이 멀쩡하면 이번 데미지 타격을 무효로 막고 탈을 깬다(배틀당 1회).
  // 면역/원더가드로 이미 0이면 발동하지 않는다(damage>0 게이트). 틀깨기면 무시.
  const wildDisguise = checkDisguiseBreak(
    battle.wild, moveData.category, result.damage, battle.wildDisguiseBusted === true, battle.wild.maxHp, playerBreaksMold,
  );
  if (wildDisguise.broke) {
    result.damage = 0;
    battle.wildDisguiseBusted = true;
    hitSuppressed = true;
  }

  // 기합의띠/기합의머리띠: post-damage HP를 쓰기 전에 일격 버티기 판정
  const wildAtFull = battle.wild.hp >= battle.wild.maxHp;
  const survive = tryFocusSurvive(battle.wild, result.damage, wildAtFull);
  if (survive.kind) {
    result.damage = survive.finalDamage;
    if (survive.consumed) battle.wild.heldItem = null;
  } else if (result.damage >= battle.wild.hp && battle.wild.hp > 0 && abilitySurvivesKO(battle.wild, wildAtFull, playerBreaksMold)) {
    // 옹골참(sturdy): 풀피에서 일격사를 HP 1로 버틴다(기합의띠 미발동 시). 틀깨기면 무시.
    result.damage = battle.wild.hp - 1;
    log.push(`${getDisplaySpeciesName(battle.wild.species)}은(는) 옹골참으로 버텼다!`);
  }

  battle.wild.hp = Math.max(0, battle.wild.hp - result.damage);
  log.push(`${getDisplaySpeciesName(player.species)}의 ${moveData.name}! ${result.missed ? "빗나갔다!" : `${result.damage} 데미지!`}`);
  if (wildWonderGuardBlocks) log.push(`${getDisplaySpeciesName(battle.wild.species)}은(는) 원더가드로 데미지를 받지 않았다!`);
  if (wildDisguise.broke) {
    log.push(`${getDisplaySpeciesName(battle.wild.species)}의 탈이 벗겨졌다!`);
    // 탈이 깨지면 modern-gen 사양으로 자가 도트(maxHp/8). 매직가드면 도트 무효.
    if (wildDisguise.chipDamage > 0 && battle.wild.hp > 0 && !abilityBlocksIndirectDamage(battle.wild)) {
      battle.wild.hp = Math.max(0, battle.wild.hp - wildDisguise.chipDamage);
      log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}은(는) 탈이 벗겨지며 ${wildDisguise.chipDamage} 데미지를 받았다!`);
    }
  }
  // 급소(크리티컬) — 빗나가지 않은 데미지 기술에서만 표시
  if (!result.missed && result.critical && moveData.category !== "status") log.push("급소에 맞았다!");
  if (result.message) log.push(result.message);
  if (survive.kind === "focus-sash") log.push("기합의띠로 버텼다!");
  else if (survive.kind === "focus-band") log.push("기합의머리띠로 버텼다!");

  let flinchCaused = false;

  if (!result.missed) {
    // 생명의구슬 반동: 데미지를 입힌 비-status 공격 직후 보유자 HP 감소. 매직가드면 반동 무효.
    if (moveData.category !== "status" && result.damage > 0 && !abilityBlocksIndirectDamage(player)) {
      applyLifeOrbRecoil(player, log);
    }
    // 위기 회복 나무열매(기력의탄산수): 야생이 데미지를 받은 직후 조건 충족 시 회복
    maybeConsumePinchBerry(battle.wild, log, `야생 ${getDisplaySpeciesName(battle.wild.species)}`);

    // Apply meta effects for player. 매직가드는 기술 반동(음수 hpChange)을 무효로 한다(흡수 회복은 유지).
    const metaResult = applyMetaEffects(moveData, result.damage, player.hp, player.maxHp);
    let playerMetaHpChange = metaResult.hpChange;
    if (playerMetaHpChange < 0 && abilityBlocksIndirectDamage(player)) playerMetaHpChange = 0;
    if (playerMetaHpChange !== 0) {
      player.hp = Math.max(0, Math.min(player.maxHp, player.hp + playerMetaHpChange));
    }
    for (const msg of metaResult.messages) log.push(msg);

    // Apply stat changes for player (원더가드/탈로 타격이 무효화되면 부가효과도 스킵)
    if (!hitSuppressed) maybeApplyStatChanges(battle, moveData, true, log, { player, wild: battle.wild });

    // Apply ailment to wild from player attack (필드/특성 상태이상 차단 게이팅 포함).
    // 원더가드/탈로 타격이 무효화되면 상태이상 부여도 스킵한다.
    if (!hitSuppressed) {
      const ailmentResult = maybeApplyAilment(
        moveData,
        battle.wild.statusCondition,
        battle.wildVolatile ?? [],
        log,
        battle,
        wildDefTypes,
        battle.wild,
      );
      if (ailmentResult.newStatus) {
        battle.wild.statusCondition = ailmentResult.newStatus;
      }
      battle.wildVolatile = ailmentResult.newVolatiles;
    }

    // 접촉(=물리 프록시) 피격 특성: 야생(방어자)의 static/flame-body/poison-point/rough-skin/iron-barbs
    if (moveData.category === "physical" && result.damage > 0) {
      const contact = applyContactAbilities(battle.wild, player.statusCondition != null, player.maxHp);
      if (contact.inflictStatus && !player.statusCondition) {
        player.statusCondition = contact.inflictStatus;
        const names: Record<string, string> = { poison: "독", burn: "화상", paralysis: "마비" };
        log.push(`${getDisplaySpeciesName(player.species)}은(는) ${names[contact.inflictStatus] ?? contact.inflictStatus} 상태가 되었다!`);
      }
      if (contact.recoilDamage && player.hp > 0 && !abilityBlocksIndirectDamage(player)) {
        player.hp = Math.max(0, player.hp - contact.recoilDamage);
        log.push(`${getDisplaySpeciesName(player.species)}은(는) 상대 특성으로 ${contact.recoilDamage} 데미지를 받았다!`);
      }
    }

    // Check flinch
    // "apply if under": roll < chance means flinch IS applied
    // inner-focus 특성을 가진 대상(야생)은 풀죽음에 면역이다.
    // 원더가드/탈로 타격이 무효화되면 풀죽음도 유발하지 않는다.
    const flinchChance = moveData.meta?.flinchChance ?? 0;
    if (!hitSuppressed && flinchChance > 0 && !hasAbility(battle.wild, "inner-focus") && Math.random() * 100 < flinchChance) {
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
  log: string[] = [],
): "player" | "wild" {
  let playerSpeedBase = player.stats.speed;
  if (player.statusCondition === "paralysis") {
    playerSpeedBase = Math.max(1, Math.floor(playerSpeedBase / 2));
  }
  let wildSpeedBase = battle.wild.stats.speed;
  if (battle.wild.statusCondition === "paralysis") {
    wildSpeedBase = Math.max(1, Math.floor(wildSpeedBase / 2));
  }

  // 특성 속도 배율(swift-swim·chlorophyll·sand-rush·slush-rush): 날씨 일치 시 ×2.
  const playerSpeedAbilityMult = getAbilitySpeedMultiplier(player, battle.weather);
  const wildSpeedAbilityMult = getAbilitySpeedMultiplier(battle.wild, battle.weather);

  const playerSpeed = applyStatStageMultiplier(playerSpeedBase, battle.playerStatStages?.speed ?? 0) * playerSpeedAbilityMult;
  const wildSpeed = applyStatStageMultiplier(wildSpeedBase, battle.wildStatStages?.speed ?? 0) * wildSpeedAbilityMult;

  // 선제공격손톱(quick-claw): 속도 비교 전 20% 확률로 선공.
  // 우선도(priority)가 같을 때만 의미가 있으므로 동일 우선도에서 판정한다.
  const playerPriority = playerMoveData.priority ?? 0;
  const wildPriority = wildMoveData.priority ?? 0;
  if (playerPriority === wildPriority) {
    if (quickClawTriggers(player)) {
      log.push("빠른발톱이 발동!");
      return "player";
    }
    if (quickClawTriggers(battle.wild)) {
      log.push("빠른발톱이 발동!");
      return "wild";
    }
  }

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
/** 특성 턴 종료 회복/데미지(speed-boost 제외)를 HP에 적용한다. */
function applyAbilityEotHpChange(
  mon: { hp: number; maxHp: number },
  eot: { healing: number; message?: string },
  log: string[],
  displayName: string,
): void {
  if (mon.hp <= 0) return;
  if (eot.healing > 0) {
    if (mon.hp >= mon.maxHp) return;
    mon.hp = Math.min(mon.maxHp, mon.hp + eot.healing);
    if (eot.message) log.push(`${displayName}은(는) ${eot.message}`);
  } else if (eot.healing < 0) {
    mon.hp = Math.max(0, mon.hp + eot.healing);
    if (eot.message) log.push(`${displayName}은(는) ${eot.message}`);
  }
}

export function applyEndOfTurnBattle(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  // 특성 턴 종료 효과(poison-heal·rain-dish·dry-skin·ice-body·speed-boost) — 양측 선계산.
  // poison-heal은 기존 독 데미지를 취소하고 회복으로 대체하므로 EOT 데미지 적용 전에 처리한다.
  const playerAbilityEot = applyEndOfTurnAbilities(myPokemon, battle.weather, myPokemon.statusCondition === "poison", myPokemon.maxHp);
  const wildAbilityEot = applyEndOfTurnAbilities(battle.wild, battle.weather, battle.wild.statusCondition === "poison", battle.wild.maxHp);

  // Player end-of-turn status/volatile effects
  const playerEot = applyEndOfTurn(
    myPokemon.statusCondition,
    battle.playerVolatile ?? [],
    myPokemon.maxHp,
    battle.wild.maxHp,
  );
  // poison-heal: 독 데미지(maxHp/8)와 그 메시지를 제거한다.
  let playerEotDamage = playerEot.damage;
  let playerEotMessages = playerEot.messages;
  let playerLeechHeal = playerEot.opponentHealing;
  if (playerAbilityEot.cancelPoison && myPokemon.statusCondition === "poison") {
    playerEotDamage = Math.max(0, playerEotDamage - Math.max(1, Math.floor(myPokemon.maxHp / 8)));
    playerEotMessages = playerEotMessages.filter((m) => m !== "독 데미지를 받았다!");
  }
  // 매직가드(플레이어): 독/화상/씨뿌리기/조이기 등 간접 데미지 무효(씨뿌리기 흡수도 함께 없앤다).
  if (abilityBlocksIndirectDamage(myPokemon)) {
    playerEotDamage = 0;
    playerLeechHeal = 0;
    playerEotMessages = [];
  }
  if (playerEotDamage > 0) {
    myPokemon.hp = Math.max(0, myPokemon.hp - playerEotDamage);
  }
  if (playerEot.healing > 0) {
    myPokemon.hp = Math.min(myPokemon.maxHp, myPokemon.hp + playerEot.healing);
  }
  if (playerLeechHeal > 0) {
    battle.wild.hp = Math.min(battle.wild.maxHp, battle.wild.hp + playerLeechHeal);
  }
  for (const msg of playerEotMessages) log.push(`${getDisplaySpeciesName(myPokemon.species)}: ${msg}`);

  // Wild end-of-turn status/volatile effects
  const wildEot = applyEndOfTurn(
    battle.wild.statusCondition,
    battle.wildVolatile ?? [],
    battle.wild.maxHp,
    myPokemon.maxHp,
  );
  let wildEotDamage = wildEot.damage;
  let wildEotMessages = wildEot.messages;
  let wildLeechHeal = wildEot.opponentHealing;
  if (wildAbilityEot.cancelPoison && battle.wild.statusCondition === "poison") {
    wildEotDamage = Math.max(0, wildEotDamage - Math.max(1, Math.floor(battle.wild.maxHp / 8)));
    wildEotMessages = wildEotMessages.filter((m) => m !== "독 데미지를 받았다!");
  }
  // 매직가드(야생): 간접 데미지 무효(씨뿌리기 흡수도 함께 없앤다).
  if (abilityBlocksIndirectDamage(battle.wild)) {
    wildEotDamage = 0;
    wildLeechHeal = 0;
    wildEotMessages = [];
  }
  if (wildEotDamage > 0) {
    battle.wild.hp = Math.max(0, battle.wild.hp - wildEotDamage);
  }
  if (wildEot.healing > 0) {
    battle.wild.hp = Math.min(battle.wild.maxHp, battle.wild.hp + wildEot.healing);
  }
  if (wildLeechHeal > 0) {
    myPokemon.hp = Math.min(myPokemon.maxHp, myPokemon.hp + wildLeechHeal);
  }
  for (const msg of wildEotMessages) log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}: ${msg}`);

  // 특성 회복/데미지 적용(rain-dish·ice-body·dry-skin·poison-heal). 회복은 hp>0이고 풀피 아닐 때만,
  // 데미지(dry-skin 햇살)는 hp>0일 때만. speed-boost는 아래에서 별도 단계 증가.
  applyAbilityEotHpChange(myPokemon, playerAbilityEot, log, getDisplaySpeciesName(myPokemon.species));
  applyAbilityEotHpChange(battle.wild, wildAbilityEot, log, `야생 ${getDisplaySpeciesName(battle.wild.species)}`);

  // speed-boost: 턴 종료 시 speed 단계 +1(상한 +6은 applyStatChanges가 클램프).
  if (playerAbilityEot.speedBoost && myPokemon.hp > 0) {
    battle.playerStatStages = applyStatChanges(battle.playerStatStages ?? defaultStatStages(), [{ stat: "speed", change: 1 }]);
    log.push(`${getDisplaySpeciesName(myPokemon.species)}의 스피드가 올랐다!`);
  }
  if (wildAbilityEot.speedBoost && battle.wild.hp > 0) {
    battle.wildStatStages = applyStatChanges(battle.wildStatStages ?? defaultStatStages(), [{ stat: "speed", change: 1 }]);
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}의 스피드가 올랐다!`);
  }

  // 지닌물건 턴 종료 회복(먹다남은음식) — 양측
  applyHeldEndOfTurnHeal(myPokemon, log, getDisplaySpeciesName(myPokemon.species));
  applyHeldEndOfTurnHeal(battle.wild, log, `야생 ${getDisplaySpeciesName(battle.wild.species)}`);

  // Tick volatile statuses
  // 하품(yawn): 카운터가 다 떨어져 제거되는 순간, 대상에게 주상태이상이 없으면 잠듦.
  const playerHadYawn = hasVolatile(battle.playerVolatile ?? [], "yawn");
  const wildHadYawn = hasVolatile(battle.wildVolatile ?? [], "yawn");
  battle.playerVolatile = tickVolatiles(battle.playerVolatile ?? []);
  battle.wildVolatile = tickVolatiles(battle.wildVolatile ?? []);

  if (playerHadYawn && !hasVolatile(battle.playerVolatile, "yawn") && !myPokemon.statusCondition) {
    myPokemon.statusCondition = "sleep";
    myPokemon.sleepTurns = rollSleepTurns();
    log.push(`${getDisplaySpeciesName(myPokemon.species)}은(는) 잠들어 버렸다!`);
  }
  if (wildHadYawn && !hasVolatile(battle.wildVolatile, "yawn") && !battle.wild.statusCondition) {
    battle.wild.statusCondition = "sleep";
    battle.wild.sleepTurns = rollSleepTurns();
    log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}은(는) 잠들어 버렸다!`);
  }

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
  // 대상(플레이어)이 terastallize했으면 그 테라 타입. 주어지면 방어 시 유효 타입을 [teraType]로 치환.
  targetTeraType?: string | null,
): { damage: number; moveId: string | null; moveData: MoveData | null; message: string; missed?: boolean; critical?: boolean; priority?: number; effectiveness?: number } {
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

  // 방어자(플레이어) 유효 타입 — terastallize했으면 [teraType]로 치환(본가식 방어 타입 변경).
  const targetDefTypes = targetTeraType
    ? [targetTeraType]
    : getEffectiveTypes(targetSpecies, targetVariantId, targetBattleForm);

  const result = calculateDamage(
    wildLevel,
    wildStats,
    targetStats,
    moveData,
    getEffectiveTypes(wildSpecies, wildVariantId, wildBattleForm),
    targetDefTypes,
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
    critical: result.critical,
    priority: moveData.priority ?? 0,
    effectiveness: result.effectiveness,
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
  // 수면 턴 감소·기상 — 플레이어(resolvePreAttack)와 대칭. checkPreAttack은 수면 턴을 관리하지
  // 않으므로(status-conditions.ts: "sleepTurns is managed externally") 야생/보스도 여기서 매 턴
  // sleepTurns를 줄이고 0이 되면 깨워야 한다. 이 처리가 없으면 잠든 야생/보스가 영원히 깨지 않는다.
  if (battle.wild.statusCondition === "sleep") {
    if (battle.wild.sleepTurns !== undefined && battle.wild.sleepTurns > 0) {
      battle.wild.sleepTurns -= 1;
    }
    if (battle.wild.sleepTurns !== undefined && battle.wild.sleepTurns <= 0) {
      battle.wild.statusCondition = null;
      battle.wild.sleepTurns = undefined;
      log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}이(가) 잠에서 깨어났다!`);
    }
  }

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

  // 지닌물건 방어 보정: 플레이어가 돌격조끼 보유 시 특수 데미지 ÷1.5
  const playerSpDefMod = wildMoveData ? getHeldSpDefMultiplier(myPokemon, wildMoveData.category) : 1;

  // 틀깨기(야생 공격자): 야생이 이 특성이면 플레이어 방어 특성을 무시.
  const wildBreaksMold = attackerBreaksMold(battle.wild);

  // 배짱없음(unaware): 공격자(야생)가 unaware면 플레이어 방어 랭크 무시, 플레이어가 unaware면
  // 야생 공격 랭크 무시. 없으면 원본 참조 그대로(byte-identical).
  const wildUnaware = resolveUnawareStages(battle.wild, myPokemon, battle.wildStatStages, battle.playerStatStages);

  const wildResult = wildAttack(
    battle.wild.species, battle.wild.level, wildStats,
    battle.wild.moves, myPokemon.stats, myPokemon.species,
    wildUnaware.attackerStages, wildUnaware.defenderStages,
    preSelectedWildMove,
    battle.wild.variantId, myPokemon.variantId,
    (wildWeatherMod * wildTerrainMod) / playerSpDefMod,
    battle.wildBattleForm, battle.playerBattleForm,
    // 플레이어가 terastallize했으면 방어 유효 타입을 [teraType]로 치환(데미지 타입상성용).
    (battle.playerTerastallized && battle.playerTeraType) ? battle.playerTeraType : null,
  );

  // 특성 방어 면역/흡수(플레이어 방어자): 데미지 적용 전 판정.
  // 면역이면 데미지 0, 2차효과/접촉/풀죽음 스킵하고 heal/boost만 적용. 틀깨기면 무시.
  if (wildResult.moveData && wildResult.moveData.category !== "status") {
    const immunity = checkAbilityImmunity(myPokemon, wildResult.moveData.type, wildResult.moveData.category, wildBreaksMold);
    if (immunity.immune) {
      log.push(`${getDisplaySpeciesName(myPokemon.species)}에게는 효과가 없는 것 같다...`);
      if (immunity.healFraction) {
        const heal = Math.max(1, Math.floor(myPokemon.maxHp * immunity.healFraction));
        if (myPokemon.hp > 0 && myPokemon.hp < myPokemon.maxHp) {
          myPokemon.hp = Math.min(myPokemon.maxHp, myPokemon.hp + heal);
          log.push(`${getDisplaySpeciesName(myPokemon.species)}이(가) ${heal} 회복했다!`);
        }
      }
      if (immunity.boostStat) {
        battle.playerStatStages = applyStatChanges(battle.playerStatStages ?? defaultStatStages(), [{ stat: immunity.boostStat, change: 1 }]);
        log.push(`${getDisplaySpeciesName(myPokemon.species)}의 능력이 올랐다!`);
      }
      checkHpForms(battle, myPokemon, log);
      return await handleFainted(user, myPokemon, battle, log);
    }
  }

  // 지닌물건 공격 보정(야생 보유자용 — 야생은 보통 미지닌이라 1로 no-op).
  // 야생은 effectiveness 정보가 없으므로 super-effective 의존 효과(달인의띠)는 미적용.
  if (wildResult.moveData && wildResult.damage > 0) {
    const wildOffenseMod = getHeldOffenseMultiplier(battle.wild, wildResult.moveData.category, false);
    if (wildOffenseMod !== 1) wildResult.damage = Math.floor(wildResult.damage * wildOffenseMod);
  }

  // 특성 공격 보정(야생 공격자) — STAB은 야생 타입 기준, 상태이상 보유 여부 반영 + 조건부(sheer-force 등).
  const wildEffectiveness = wildResult.effectiveness ?? 1;
  if (wildResult.moveData && wildResult.damage > 0) {
    const wildAbilityOffenseMod = getAbilityOffenseMultiplier(
      battle.wild, wildResult.moveData.type, wildResult.moveData.category, wildResult.moveData.power,
      battle.wild.maxHp > 0 ? battle.wild.hp / battle.wild.maxHp : 0,
      wildAtkTypes.includes(wildResult.moveData.type),
      battle.wild.statusCondition != null,
      buildOffenseContext(wildResult.moveId ?? "", wildResult.moveData, wildEffectiveness, wildResult.critical ?? false, battle.weather),
    );
    if (wildAbilityOffenseMod !== 1) wildResult.damage = Math.floor(wildResult.damage * wildAbilityOffenseMod);
  }

  // 특성 방어 보정(플레이어 방어자). 이제 wildAttack이 effectiveness를 반환하므로 super-effective 의존
  // 효과(filter 등)도 정확히 적용된다. 틀깨기면 무시.
  if (wildResult.moveData && wildResult.damage > 0) {
    const playerAbilityDefenseMod = getAbilityDefenseMultiplier(
      myPokemon, wildResult.moveData.type,
      myPokemon.maxHp > 0 ? myPokemon.hp / myPokemon.maxHp : 0,
      wildEffectiveness > 1,
      wildBreaksMold,
    );
    if (playerAbilityDefenseMod !== 1) wildResult.damage = Math.floor(wildResult.damage * playerAbilityDefenseMod);
  }

  // 원더가드(플레이어 방어자): 효과가 굉장하지 않은 데미지 기술은 데미지 0. 틀깨기면 무시.
  let wildHitSuppressed = false;
  if (wildResult.moveData) {
    const playerWonderGuardBlocks = abilityNullifiesNonSuperEffective(myPokemon, wildResult.moveData.category, wildEffectiveness > 1, wildBreaksMold);
    if (playerWonderGuardBlocks && wildResult.damage > 0) {
      wildResult.damage = 0;
      wildHitSuppressed = true;
    }
  }

  // 탈(disguise, 플레이어 방어자): 아직 탈이 멀쩡하면 이번 데미지 타격을 무효로 막고 탈을 깬다(배틀당 1회).
  const playerDisguise = wildResult.moveData
    ? checkDisguiseBreak(myPokemon, wildResult.moveData.category, wildResult.damage, battle.playerDisguiseBusted === true, myPokemon.maxHp, wildBreaksMold)
    : { broke: false, chipDamage: 0 };
  if (playerDisguise.broke) {
    wildResult.damage = 0;
    battle.playerDisguiseBusted = true;
    wildHitSuppressed = true;
  }

  // 기합의띠/기합의머리띠: post-damage HP를 쓰기 전에 플레이어 일격 버티기 판정
  const playerAtFull = myPokemon.hp >= myPokemon.maxHp;
  const wildSurvive = tryFocusSurvive(myPokemon, wildResult.damage, playerAtFull);
  if (wildSurvive.kind) {
    wildResult.damage = wildSurvive.finalDamage;
    if (wildSurvive.consumed) myPokemon.heldItem = null;
  } else if (wildResult.damage >= myPokemon.hp && myPokemon.hp > 0 && abilitySurvivesKO(myPokemon, playerAtFull, wildBreaksMold)) {
    // 옹골참(sturdy): 풀피에서 일격사를 HP 1로 버틴다. 틀깨기면 무시.
    wildResult.damage = myPokemon.hp - 1;
    log.push(`${getDisplaySpeciesName(myPokemon.species)}은(는) 옹골참으로 버텼다!`);
  }

  const previousHp = myPokemon.hp;
  myPokemon.hp = Math.max(0, myPokemon.hp - wildResult.damage);
  recordDamageTaken(myPokemon, previousHp - myPokemon.hp);
  log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}의 공격! ${wildResult.damage} 데미지!`);
  if (wildHitSuppressed && !playerDisguise.broke) log.push(`${getDisplaySpeciesName(myPokemon.species)}은(는) 원더가드로 데미지를 받지 않았다!`);
  if (playerDisguise.broke) {
    log.push(`${getDisplaySpeciesName(myPokemon.species)}의 탈이 벗겨졌다!`);
    // 탈이 깨지면 modern-gen 사양으로 자가 도트(maxHp/8). 매직가드면 도트 무효.
    if (playerDisguise.chipDamage > 0 && myPokemon.hp > 0 && !abilityBlocksIndirectDamage(myPokemon)) {
      myPokemon.hp = Math.max(0, myPokemon.hp - playerDisguise.chipDamage);
      log.push(`${getDisplaySpeciesName(myPokemon.species)}은(는) 탈이 벗겨지며 ${playerDisguise.chipDamage} 데미지를 받았다!`);
    }
  }
  // 급소(크리티컬) — 빗나가지 않은 데미지 기술에서만 표시
  if (!wildResult.missed && wildResult.critical && wildResult.moveData?.category !== "status") log.push("급소에 맞았다!");
  if (wildSurvive.kind === "focus-sash") log.push("기합의띠로 버텼다!");
  else if (wildSurvive.kind === "focus-band") log.push("기합의머리띠로 버텼다!");
  // 생명의구슬 반동(야생 보유자용 — 보통 no-op). 매직가드면 반동 무효.
  if (wildResult.moveData && !wildResult.missed && wildResult.moveData.category !== "status" && wildResult.damage > 0 && !abilityBlocksIndirectDamage(battle.wild)) {
    applyLifeOrbRecoil(battle.wild, log);
  }
  // 위기 회복 나무열매: 플레이어가 데미지를 받은 직후 조건 충족 시 회복
  maybeConsumePinchBerry(myPokemon, log, getDisplaySpeciesName(myPokemon.species));
  if (wildResult.message) log.push(wildResult.message);

  // Apply meta effects for wild pokemon (only if the attack didn't miss)
  if (wildResult.moveData && !wildResult.missed) {
    const metaResult = applyMetaEffects(wildResult.moveData, wildResult.damage, battle.wild.hp, battle.wild.maxHp);
    let wildMetaHpChange = metaResult.hpChange;
    if (wildMetaHpChange < 0 && abilityBlocksIndirectDamage(battle.wild)) wildMetaHpChange = 0;
    if (wildMetaHpChange !== 0) {
      battle.wild.hp = Math.max(0, Math.min(battle.wild.maxHp, battle.wild.hp + wildMetaHpChange));
    }
    for (const msg of metaResult.messages) log.push(msg);

    // Apply stat changes for wild pokemon (원더가드/탈로 타격이 무효화되면 부가효과도 스킵)
    if (!wildHitSuppressed) maybeApplyStatChanges(battle, wildResult.moveData, false, log, { player: myPokemon, wild: battle.wild });

    // Apply ailment to player from wild attack (필드/특성 상태이상 차단 게이팅 포함).
    // 원더가드/탈로 타격이 무효화되면 상태이상 부여도 스킵한다.
    if (!wildHitSuppressed) {
      const ailmentResult = maybeApplyAilment(
        wildResult.moveData,
        myPokemon.statusCondition,
        battle.playerVolatile ?? [],
        log,
        battle,
        playerDefTypes,
        myPokemon,
      );
      if (ailmentResult.newStatus) {
        myPokemon.statusCondition = ailmentResult.newStatus;
        if (ailmentResult.sleepTurns !== undefined) myPokemon.sleepTurns = ailmentResult.sleepTurns;
      }
      battle.playerVolatile = ailmentResult.newVolatiles;
    }

    // 접촉(=물리 프록시) 피격 특성: 플레이어(방어자)의 static/flame-body/poison-point/rough-skin/iron-barbs
    if (wildResult.moveData.category === "physical" && wildResult.damage > 0) {
      const contact = applyContactAbilities(myPokemon, battle.wild.statusCondition != null, battle.wild.maxHp);
      if (contact.inflictStatus && !battle.wild.statusCondition) {
        battle.wild.statusCondition = contact.inflictStatus;
        const names: Record<string, string> = { poison: "독", burn: "화상", paralysis: "마비" };
        log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}은(는) ${names[contact.inflictStatus] ?? contact.inflictStatus} 상태가 되었다!`);
      }
      if (contact.recoilDamage && battle.wild.hp > 0 && !abilityBlocksIndirectDamage(battle.wild)) {
        battle.wild.hp = Math.max(0, battle.wild.hp - contact.recoilDamage);
        log.push(`야생 ${getDisplaySpeciesName(battle.wild.species)}은(는) 상대 특성으로 ${contact.recoilDamage} 데미지를 받았다!`);
      }
    }

    // 풀죽음(flinch) 판정 — executePlayerAttack와 동일하게 "apply if under"(roll < chance).
    // 야생이 선공한 경우에만 의미가 있으므로 battle.playerFlinched 임시 플래그로 알린다.
    // inner-focus 특성을 가진 플레이어는 풀죽음에 면역이다. 원더가드/탈로 무효화되면 풀죽음도 없음.
    const wildFlinchChance = wildResult.moveData.meta?.flinchChance ?? 0;
    if (!wildHitSuppressed && wildFlinchChance > 0 && !hasAbility(myPokemon, "inner-focus") && Math.random() * 100 < wildFlinchChance) {
      battle.playerFlinched = true;
    }

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
