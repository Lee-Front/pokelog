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
import {
  getWeatherFromMove, getWeatherTypeModifier, getWeatherDamage,
  tickWeather, getDefaultWeatherTurns,
} from "../game/weather.js";
import {
  checkPostAttackForm, checkHpThresholdForm, checkTurnForm,
  checkWeatherForm, checkFirstHitForm, checkPostSurfForm,
  checkMoveForm, getBattleEndForm,
} from "../game/battle-forms.js";
import {
  checkPrimalReversion, canMegaEvolve, canGigantamax,
  getTransformedStats, applyGmaxHp, revertGmaxHp,
} from "../game/battle-transformations.js";

export const battleRoutes = Router();
battleRoutes.use(authMiddleware);

function getTypes(species: string, variantId?: string | null, battleForm?: string | null): string[] {
  // Battle form takes priority over variantId
  const formToCheck = battleForm ?? variantId;
  if (formToCheck) {
    const variant = getVariants().find(v => v.id === formToCheck);
    if (variant?.typing) return variant.typing;
  }
  return getSpeciesByName(species)?.types ?? [];
}

/** Apply a form change result for player or wild, updating BattleState and log */
function applyBattleFormChange(
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

/** Set weather from a move, and trigger weather-based form changes */
function maybeSetWeather(
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
    sun: "쾌청", rain: "비", hail: "싸라기눈", sandstorm: "모래바람",
  };
  log.push(`${weatherNames[weather] ?? weather} 상태가 되었다!`);

  // Check weather-based form changes for both sides
  applyBattleFormChange(
    battle,
    checkWeatherForm(playerSpecies, battle.weather, battle.playerBattleForm ?? null),
    "player", log,
  );
  applyBattleFormChange(
    battle,
    checkWeatherForm(battle.wild.species, battle.weather, battle.wildBattleForm ?? null),
    "wild", log,
  );
}

/** Apply end-of-turn weather damage and tick weather counter */
function applyWeatherEndOfTurn(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  if (!battle.weather) return;

  // Weather chip damage
  const playerTypes = getTypes(myPokemon.species, myPokemon.variantId, battle.playerBattleForm);
  const wildTypes = getTypes(battle.wild.species, battle.wild.variantId, battle.wildBattleForm);

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

  // Tick weather
  const tick = tickWeather(battle.weather, battle.weatherTurns);
  battle.weather = tick.weather;
  battle.weatherTurns = tick.turns;

  if (tick.expired) {
    log.push("날씨가 원래대로 돌아왔다!");
    // Weather-form pokemon revert when weather ends
    applyBattleFormChange(
      battle,
      checkWeatherForm(myPokemon.species, undefined, battle.playerBattleForm ?? null),
      "player", log,
    );
    applyBattleFormChange(
      battle,
      checkWeatherForm(battle.wild.species, undefined, battle.wildBattleForm ?? null),
      "wild", log,
    );
  }
}

/** Check HP-threshold form changes for both sides */
function checkHpForms(
  battle: BattleState,
  myPokemon: OwnedPokemon,
  log: string[],
): void {
  applyBattleFormChange(
    battle,
    checkHpThresholdForm(myPokemon.species, myPokemon.hp, myPokemon.maxHp, myPokemon.level, battle.playerBattleForm ?? myPokemon.variantId ?? null),
    "player", log,
  );
  applyBattleFormChange(
    battle,
    checkHpThresholdForm(battle.wild.species, battle.wild.hp, battle.wild.maxHp, battle.wild.level, battle.wildBattleForm ?? battle.wild.variantId ?? null),
    "wild", log,
  );
}

/** Revert battle forms at end of battle */
function revertBattleForms(battle: BattleState, myPokemon: OwnedPokemon): void {
  // Revert gigantamax HP if active
  if (battle.transformationType === "gigantamax" && battle.playerPreTransformMaxHp != null) {
    const reverted = revertGmaxHp(myPokemon.hp, myPokemon.maxHp, battle.playerPreTransformMaxHp);
    myPokemon.hp = reverted.hp;
    myPokemon.maxHp = reverted.maxHp;
  }

  // If mega/primal had stat overrides, revert stats to original
  if (battle.transformationType === "mega" || battle.transformationType === "primal") {
    const originalStats = getTransformedStats(myPokemon, myPokemon.variantId ?? "");
    myPokemon.stats = originalStats.stats;
    myPokemon.maxHp = originalStats.maxHp;
    if (myPokemon.hp > myPokemon.maxHp) myPokemon.hp = myPokemon.maxHp;
  }

  // Clear transformation state
  battle.transformationType = null;
  battle.transformationUsed = undefined;
  battle.gmaxTurnsRemaining = undefined;
  battle.playerPreTransformMaxHp = undefined;

  // Only clear battle form tracking — don't change the pokemon's actual variantId
  battle.playerBattleForm = undefined;
  battle.wildBattleForm = undefined;
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
  weatherModifier: number = 1,
  wildBattleForm?: string | null,
  targetBattleForm?: string | null,
) {
  const availableMoves = wildMoves.filter((m) => m.pp > 0);
  if (availableMoves.length === 0) return { damage: 0, moveId: null, moveData: null, message: "야생 포켓몬이 발버둥쳤다!" };

  const chosen = preSelectedMove ?? availableMoves[Math.floor(Math.random() * availableMoves.length)];
  const moveData: MoveData | null = getMoveById(chosen.id) ?? null;
  if (!moveData) return { damage: 0, moveId: chosen.id, moveData: null, message: "" };

  chosen.pp -= 1;

  const result = calculateDamage(
    wildLevel, wildStats, targetStats, moveData,
    getTypes(wildSpecies, wildVariantId, wildBattleForm), getTypes(targetSpecies, targetVariantId, targetBattleForm),
    attackerStages, defenderStages,
    weatherModifier,
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
  revertBattleForms(battle, pokemon);
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
  const moveId = data?.moveId as string | undefined;
  if (!moveId) { res.status(400).json({ error: "사용할 기술을 선택해주세요" }); return; }

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

  let playerCausedFlinch = false;

  function playerAttack() {
    selectedMove.pp -= 1;
    recordMoveUsage(myPokemon, selectedMove.id);

    // Burn modifier: halve attack stat for physical moves
    const playerStats = { ...myPokemon.stats };
    if (myPokemon.statusCondition === "burn") {
      playerStats.attack = Math.max(1, Math.floor(playerStats.attack / 2));
    }

    // Weather type modifier for player attack
    const playerWeatherMod = battle.weather ? getWeatherTypeModifier(battle.weather, selectedMoveData.type) : 1;

    const result = calculateDamage(
      myPokemon.level, playerStats, battle.wild.stats, selectedMoveData,
      getTypes(myPokemon.species, myPokemon.variantId, battle.playerBattleForm),
      getTypes(battle.wild.species, battle.wild.variantId, battle.wildBattleForm),
      battle.playerStatStages, battle.wildStatStages,
      playerWeatherMod,
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

      // Player post-attack form check (aegislash)
      applyBattleFormChange(
        battle,
        checkPostAttackForm(myPokemon.species, selectedMoveData.category, battle.playerBattleForm ?? myPokemon.variantId ?? null),
        "player", log,
      );

      // Player move-based form check (meloetta)
      applyBattleFormChange(
        battle,
        checkMoveForm(myPokemon.species, selectedMove.id, battle.playerBattleForm ?? myPokemon.variantId ?? null),
        "player", log,
      );

      // Player post-surf form (cramorant)
      if (selectedMove.id === "surf" || selectedMove.id === "dive") {
        applyBattleFormChange(
          battle,
          checkPostSurfForm(myPokemon.species, myPokemon.hp, myPokemon.maxHp),
          "player", log,
        );
      }

      // Player weather setting
      maybeSetWeather(battle, selectedMove.id, myPokemon.species, log);

      // Check eiscue first-hit for wild (was the wild hit physically?)
      if (selectedMoveData.category === "physical" && result.damage > 0) {
        applyBattleFormChange(
          battle,
          checkFirstHitForm(battle.wild.species, battle.wildBattleForm ?? battle.wild.variantId ?? null, true),
          "wild", log,
        );
      }
    }

    // HP threshold form checks after player attack
    checkHpForms(battle, myPokemon, log);
  }

  if (turnOrder === "player") {
    if (playerCanAct) {
      playerAttack();
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
        revertBattleForms(battle, myPokemon);
        user.battleState = null;
        await saveUser(user);
        res.json({ log, battleState: null, result: "win" });
        return;
      }
    }
  }

  // End-of-turn effects (status damage, volatile ticks)
  applyEndOfTurnEffects(battle, myPokemon, log);

  // End-of-turn weather damage and tick
  applyWeatherEndOfTurn(battle, myPokemon, log);

  // Gigantamax turn tick
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
