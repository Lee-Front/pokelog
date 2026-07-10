import { applyStatChanges, defaultStatStages } from "./battle.js";
import { getDefaultWeatherTurns } from "./weather.js";
import { getDefaultTerrainTurns } from "./terrain.js";
import type {
  BattleState, BattleWeather, BattleTerrain, PrimaryStatus, StatStages,
} from "../../../../shared/types.js";

// ---------------------------------------------------------------------------
// 특성(Ability) 실효화 — 순수(거의) 헬퍼 모음
//
// 모든 헬퍼는 특성이 없거나(null/undefined) 알 수 없는(미구현) 특성이면 중립값
// (배율 1, immune false, blocks false, 스위치인 효과 없음)을 반환한다. 따라서
// 무특성/미지원 특성 경로는 도입 전과 완전히 동일(byte-identical)하게 유지된다.
//
// 특성 식별자는 data/abilities/abilities.json의 PokeAPI 슬러그 id를 사용한다.
// (예: "intimidate", "volt-absorb")
//
// 기술의 "접촉(contact)" 플래그가 데이터에 없으므로, 접촉 발동 특성은
// `category === "physical"`을 접촉 프록시로 사용한다.
// ---------------------------------------------------------------------------

/** 특성만 보면 되는 최소 형태 — OwnedPokemon(abilityId)/WildPokemon(ability) 모두 호환 */
export interface AbilityHolder {
  abilityId?: string | null;
  ability?: string | null;
}

type MoveCategory = "physical" | "special" | "status" | string;

/**
 * 단일 특성 접근자 — 플레이어 액티브는 abilityId, 야생은 ability 필드를 읽는다.
 * 둘 중 존재하는 값을 반환하고, 없으면 null.
 */
export function getAbility(mon: AbilityHolder | null | undefined): string | null {
  if (!mon) return null;
  return mon.abilityId ?? mon.ability ?? null;
}

/** 특정 특성을 보유했는지(대소문자/슬러그 정확 비교) */
export function hasAbility(mon: AbilityHolder | null | undefined, id: string): boolean {
  return getAbility(mon) === id;
}

// ---------------------------------------------------------------------------
// A. 스위치인(switch-in) 특성
// ---------------------------------------------------------------------------

const WEATHER_SETTERS: Record<string, BattleWeather> = {
  "drizzle": "rain",
  "drought": "sun",
  "sand-stream": "sandstorm",
  "snow-warning": "hail",
};

const TERRAIN_SETTERS: Record<string, BattleTerrain> = {
  "electric-surge": "electric",
  "grassy-surge": "grassy",
  "misty-surge": "misty",
  "psychic-surge": "psychic",
};

const WEATHER_NAMES: Record<BattleWeather, string> = {
  sun: "강한 햇살",
  rain: "비",
  hail: "우박",
  sandstorm: "모래바람",
};

const TERRAIN_NAMES: Record<BattleTerrain, string> = {
  electric: "일렉트릭필드",
  grassy: "그래스필드",
  misty: "미스트필드",
  psychic: "사이코필드",
};

/**
 * 스위치인(또는 전투 시작) 시 발동하는 특성.
 * - intimidate: 상대(oppStages) 공격 단계 −1
 * - 날씨 세터(drizzle/drought/sand-stream/snow-warning): 날씨가 없을 때만 설정
 * - 필드 세터(*-surge): 필드가 없을 때만 설정
 *
 * selfMon = 막 등장한 포켓몬, oppStages = 상대의 stat stages(intimidate가 깎음).
 * oppStages를 mutate하지 않고 갱신된 StatStages를 반환한다(호출부가 대입).
 * 미특성/미지원이면 oppStages를 그대로 반환하고 battle/log를 건드리지 않는다.
 */
export function applySwitchInAbilities(
  battle: BattleState,
  _side: "player" | "wild",
  selfMon: AbilityHolder,
  oppStages: StatStages | undefined,
  log: string[],
): StatStages | undefined {
  const ability = getAbility(selfMon);
  if (!ability) return oppStages;

  if (ability === "intimidate") {
    const next = applyStatChanges(oppStages ?? defaultStatStages(), [{ stat: "attack", change: -1 }]);
    log.push("위협으로 상대의 공격이 떨어졌다!");
    return next;
  }

  const weather = WEATHER_SETTERS[ability];
  if (weather && !battle.weather) {
    battle.weather = weather;
    battle.weatherTurns = getDefaultWeatherTurns();
    log.push(`${WEATHER_NAMES[weather]} 상태가 되었다!`);
    return oppStages;
  }

  const terrain = TERRAIN_SETTERS[ability];
  if (terrain && !battle.terrain) {
    battle.terrain = terrain;
    battle.terrainTurns = getDefaultTerrainTurns();
    log.push(`발밑에 ${TERRAIN_NAMES[terrain]}가 깔렸다!`);
    return oppStages;
  }

  return oppStages;
}

// ---------------------------------------------------------------------------
// B. 공격 데미지 배율(offense) — 지닌물건처럼 result.damage에 post-hoc 적용
// ---------------------------------------------------------------------------

const PINCH_TYPE: Record<string, string> = {
  "overgrow": "grass",
  "blaze": "fire",
  "torrent": "water",
  "swarm": "bug",
};

/**
 * getAbilityOffenseMultiplier의 선택 컨텍스트 — 데미지 계산 결과(효과·급소)나 기술 메타에서
 * 파생되는 조건부 공격 특성용. 값을 넘기지 않으면 해당 특성은 발동하지 않고 종전과 동일하게 1을
 * 곱한다(byte-identical).
 */
export interface OffenseContext {
  isSuperEffective?: boolean;   // 효과가 굉장(effectiveness > 1)
  notVeryEffective?: boolean;   // 효과가 별로(0 < effectiveness < 1) — tinted-lens
  isCritical?: boolean;         // 급소 — sniper
  hasSecondary?: boolean;       // 부가효과(상태이상/스탯변화/풀죽음 확률) 보유 — sheer-force
  isRecoilMove?: boolean;       // 반동 기술(meta.drain < 0) — reckless
  isPunchMove?: boolean;        // 펀치 계열 기술 — iron-fist
  isContact?: boolean;          // 접촉(물리 프록시) — tough-claws
  weather?: BattleWeather;      // sand-force(모래바람) 판정용
}

/** iron-fist가 위력을 올려주는 펀치 계열 기술 id(sucker-punch는 제외 — 본가 미대상). */
const IRON_FIST_MOVES = new Set<string>([
  "bullet-punch", "comet-punch", "dizzy-punch", "drain-punch", "dynamic-punch",
  "fire-punch", "focus-punch", "ice-punch", "jet-punch", "mach-punch",
  "mega-punch", "power-up-punch", "shadow-punch", "thunder-punch",
]);

/** iron-fist 대상 펀치 기술인지(호출부가 moveId로 판정 후 context.isPunchMove로 전달). */
export function isIronFistMove(moveId: string): boolean {
  return IRON_FIST_MOVES.has(moveId);
}

/** sand-force가 위력을 올려주는 타입(모래바람에서 강철·바위·땅). */
const SAND_FORCE_TYPES = new Set<string>(["rock", "ground", "steel"]);

/**
 * 공격자 특성의 데미지 배율(곱).
 * - overgrow/blaze/torrent/swarm: HP ≤ 1/3 일 때 해당 타입 ×1.5
 * - technician: 위력 ≤ 60(>0) ×1.5
 * - huge-power/pure-power: 물리 기술 ×2
 * - guts: 물리 기술 + 주상태이상 보유 시 ×1.5
 * - adaptability: STAB(isStab)일 때 추가 ×(2/1.5)=×1.333… (순STAB ×2)
 * - (컨텍스트 의존) sheer-force ×1.3(부가효과 기술), reckless ×1.2(반동 기술),
 *   iron-fist ×1.2(펀치), tough-claws ×1.3(접촉), sand-force ×1.3(모래바람·강철/바위/땅),
 *   sniper ×1.5(급소), tinted-lens ×2(반감), neuroforce ×1.25(굉장).
 * 미특성/미지원/비대상이면 1.
 */
export function getAbilityOffenseMultiplier(
  attacker: AbilityHolder,
  moveType: string,
  moveCategory: MoveCategory,
  movePower: number,
  attackerHpFraction: number,
  isStab: boolean,
  hasPrimaryStatus: boolean,
  ctx: OffenseContext = {},
): number {
  const ability = getAbility(attacker);
  if (!ability) return 1;
  let mult = 1;

  const pinchType = PINCH_TYPE[ability];
  if (pinchType && moveType === pinchType && attackerHpFraction <= 1 / 3) mult *= 1.5;

  if (ability === "technician" && movePower > 0 && movePower <= 60) mult *= 1.5;

  if ((ability === "huge-power" || ability === "pure-power") && moveCategory === "physical") mult *= 2;

  if (ability === "guts" && moveCategory === "physical" && hasPrimaryStatus) mult *= 1.5;

  // adaptability: 이미 STAB ×1.5가 데미지식에 반영돼 있으므로 추가 ×(2/1.5)로 순 ×2.
  if (ability === "adaptability" && isStab) mult *= 2 / 1.5;

  // --- 컨텍스트 의존 공격 특성(값 미제공 시 조건 거짓 → 1) ---
  const isDamaging = moveCategory === "physical" || moveCategory === "special";

  if (ability === "sheer-force" && isDamaging && ctx.hasSecondary) mult *= 1.3;
  if (ability === "reckless" && isDamaging && ctx.isRecoilMove) mult *= 1.2;
  if (ability === "iron-fist" && isDamaging && ctx.isPunchMove) mult *= 1.2;
  if (ability === "tough-claws" && isDamaging && ctx.isContact) mult *= 1.3;
  if (ability === "sand-force" && isDamaging && ctx.weather === "sandstorm" && SAND_FORCE_TYPES.has(moveType)) mult *= 1.3;
  if (ability === "sniper" && ctx.isCritical) mult *= 1.5;
  if (ability === "tinted-lens" && ctx.notVeryEffective) mult *= 2;
  if (ability === "neuroforce" && ctx.isSuperEffective) mult *= 1.25;

  return mult;
}

// ---------------------------------------------------------------------------
// C. 방어 면역/흡수(immunity) — 데미지 적용 전 검사
// ---------------------------------------------------------------------------

export interface AbilityImmunityResult {
  immune: boolean;
  healFraction?: number;          // maxHp 대비 회복 비율
  boostStat?: keyof StatStages;   // 자신에게 줄 +1 단계
}

const NEUTRAL_IMMUNITY: AbilityImmunityResult = { immune: false };

/**
 * 방어자 특성의 타입 면역/흡수 판정. 면역이면 데미지 0 처리 후
 * heal/boost를 호출부가 적용한다(접촉/2차효과/풀죽음도 호출부에서 스킵).
 * - levitate: ground 면역
 * - volt-absorb: electric 면역 + 1/4 회복
 * - water-absorb/dry-skin: water 면역 + 1/4 회복
 * - flash-fire: fire 면역(회복 없음)
 * - lightning-rod/storm-drain: electric/water 면역 + 자신 spAttack +1
 * - motor-drive: electric 면역 + speed +1
 * - sap-sipper: grass 면역 + attack +1
 * status 기술(moveCategory==="status")은 면역 판정을 하지 않는다(데미지 없음).
 */
export function checkAbilityImmunity(
  defender: AbilityHolder,
  moveType: string,
  moveCategory: MoveCategory,
  breakMold = false,
): AbilityImmunityResult {
  const ability = getAbility(defender);
  if (!ability) return NEUTRAL_IMMUNITY;
  if (moveCategory === "status") return NEUTRAL_IMMUNITY;
  // 틀깨기(mold-breaker) 등 공격자가 방어 특성을 무시하면 타입 면역/흡수가 발동하지 않는다.
  if (breakMold) return NEUTRAL_IMMUNITY;

  switch (ability) {
    case "levitate":
      return moveType === "ground" ? { immune: true } : NEUTRAL_IMMUNITY;
    case "volt-absorb":
      return moveType === "electric" ? { immune: true, healFraction: 1 / 4 } : NEUTRAL_IMMUNITY;
    case "water-absorb":
    case "dry-skin":
      return moveType === "water" ? { immune: true, healFraction: 1 / 4 } : NEUTRAL_IMMUNITY;
    case "flash-fire":
      return moveType === "fire" ? { immune: true } : NEUTRAL_IMMUNITY;
    case "lightning-rod":
      return moveType === "electric" ? { immune: true, boostStat: "spAttack" } : NEUTRAL_IMMUNITY;
    case "storm-drain":
      return moveType === "water" ? { immune: true, boostStat: "spAttack" } : NEUTRAL_IMMUNITY;
    case "motor-drive":
      return moveType === "electric" ? { immune: true, boostStat: "speed" } : NEUTRAL_IMMUNITY;
    case "sap-sipper":
      return moveType === "grass" ? { immune: true, boostStat: "attack" } : NEUTRAL_IMMUNITY;
    default:
      return NEUTRAL_IMMUNITY;
  }
}

// ---------------------------------------------------------------------------
// D. 방어 데미지 감소(defense)
// ---------------------------------------------------------------------------

/**
 * 방어자 특성의 데미지 감소 배율(곱).
 * - thick-fat: fire & ice ×0.5
 * - heatproof: fire ×0.5
 * - multiscale: 풀피(HP fraction === 1)일 때 ×0.5
 * - filter/solid-rock/prism-armor: 효과가 굉장(super-effective)일 때 ×0.75
 * 미특성/미지원/비대상이면 1.
 */
export function getAbilityDefenseMultiplier(
  defender: AbilityHolder,
  moveType: string,
  defenderHpFraction: number,
  isSuperEffective: boolean,
  breakMold = false,
): number {
  const ability = getAbility(defender);
  if (!ability) return 1;
  // 틀깨기: 공격자가 방어 특성을 무시하면 데미지 경감이 발동하지 않는다.
  if (breakMold) return 1;
  let mult = 1;

  if (ability === "thick-fat" && (moveType === "fire" || moveType === "ice")) mult *= 0.5;
  if (ability === "heatproof" && moveType === "fire") mult *= 0.5;
  if (ability === "multiscale" && defenderHpFraction === 1) mult *= 0.5;
  if ((ability === "filter" || ability === "solid-rock" || ability === "prism-armor") && isSuperEffective) mult *= 0.75;

  return mult;
}

// ---------------------------------------------------------------------------
// E. 상태이상 면역(status immunity)
// ---------------------------------------------------------------------------

const STATUS_BLOCKERS: Record<string, PrimaryStatus> = {
  "limber": "paralysis",
  "immunity": "poison",
  "insomnia": "sleep",
  "vital-spirit": "sleep",
  "water-veil": "burn",
  "magma-armor": "freeze",
};

/**
 * 방어자 특성이 해당 주상태이상 부여를 막는지.
 * - limber→paralysis, immunity→poison, insomnia/vital-spirit→sleep,
 *   water-veil→burn, magma-armor→freeze
 * 미특성/미지원이면 false(차단 안 함).
 */
export function abilityBlocksStatus(defender: AbilityHolder, status: PrimaryStatus): boolean {
  const ability = getAbility(defender);
  if (!ability) return false;
  return STATUS_BLOCKERS[ability] === status;
}

// ---------------------------------------------------------------------------
// F. 접촉/피격 시(defender 특성, PHYSICAL 데미지 기술에 맞았을 때)
// ---------------------------------------------------------------------------

/** 접촉 피격 특성의 결과 — 호출부가 attacker에 상태/데미지를 적용한다. */
export interface ContactAbilityResult {
  inflictStatus?: PrimaryStatus;  // attacker에게 부여할 주상태이상(attacker 무상태일 때만)
  recoilDamage?: number;          // attacker가 입을 데미지(maxHp/8)
}

/**
 * 방어자가 물리(=접촉 프록시) 데미지 기술에 맞았을 때 공격자에게 가하는 효과.
 * - static: 30% 마비, flame-body: 30% 화상, poison-point: 30% 독
 *   (공격자가 이미 주상태이상이면 적용 안 함)
 * - rough-skin/iron-barbs: 공격자 max(1, floor(maxHp/8)) 데미지
 * 미특성/미지원이면 빈 결과.
 */
export function applyContactAbilities(
  defender: AbilityHolder,
  attackerHasStatus: boolean,
  attackerMaxHp: number,
  random: () => number = Math.random,
): ContactAbilityResult {
  const ability = getAbility(defender);
  if (!ability) return {};

  const result: ContactAbilityResult = {};

  if (!attackerHasStatus) {
    if (ability === "static" && random() < 0.3) result.inflictStatus = "paralysis";
    else if (ability === "flame-body" && random() < 0.3) result.inflictStatus = "burn";
    else if (ability === "poison-point" && random() < 0.3) result.inflictStatus = "poison";
  }

  if (ability === "rough-skin" || ability === "iron-barbs") {
    result.recoilDamage = Math.max(1, Math.floor(attackerMaxHp / 8));
  }

  return result;
}

// ---------------------------------------------------------------------------
// G. 턴 종료(end of turn)
// ---------------------------------------------------------------------------

export interface EndOfTurnAbilityResult {
  healing: number;        // 회복량(절대값)
  cancelPoison: boolean;  // poison-heal: 기존 독 데미지를 취소하고 healing으로 대체
  speedBoost: boolean;    // speed-boost: speed 단계 +1
  message?: string;
}

const NEUTRAL_EOT: EndOfTurnAbilityResult = { healing: 0, cancelPoison: false, speedBoost: false };

/**
 * 턴 종료 특성 효과(데미지 적용/스탯 변화는 호출부가 처리).
 * - speed-boost: speed 단계 +1(상한 호출부 cap)
 * - rain-dish: 비일 때 1/16 회복
 * - ice-body: 우박일 때 1/16 회복
 * - dry-skin: 비 1/8 회복 / 강한 햇살 1/8 데미지(음수 healing)
 * - poison-heal: 중독 시 독 데미지 취소하고 1/8 회복
 * weather는 battle.weather, isPoisoned는 주상태이상이 poison인지.
 * 미특성/미지원이면 중립값.
 */
export function applyEndOfTurnAbilities(
  mon: AbilityHolder,
  weather: BattleWeather | undefined,
  isPoisoned: boolean,
  maxHp: number,
): EndOfTurnAbilityResult {
  const ability = getAbility(mon);
  if (!ability) return NEUTRAL_EOT;

  switch (ability) {
    case "speed-boost":
      return { healing: 0, cancelPoison: false, speedBoost: true };
    case "rain-dish":
      if (weather === "rain") return { healing: Math.max(1, Math.floor(maxHp / 16)), cancelPoison: false, speedBoost: false, message: "비로 체력을 회복했다!" };
      return NEUTRAL_EOT;
    case "ice-body":
      if (weather === "hail") return { healing: Math.max(1, Math.floor(maxHp / 16)), cancelPoison: false, speedBoost: false, message: "우박으로 체력을 회복했다!" };
      return NEUTRAL_EOT;
    case "dry-skin":
      if (weather === "rain") return { healing: Math.max(1, Math.floor(maxHp / 8)), cancelPoison: false, speedBoost: false, message: "건조피부로 체력을 회복했다!" };
      if (weather === "sun") return { healing: -Math.max(1, Math.floor(maxHp / 8)), cancelPoison: false, speedBoost: false, message: "건조피부로 데미지를 받았다!" };
      return NEUTRAL_EOT;
    case "poison-heal":
      if (isPoisoned) return { healing: Math.max(1, Math.floor(maxHp / 8)), cancelPoison: true, speedBoost: false, message: "포이즌힐로 체력을 회복했다!" };
      return NEUTRAL_EOT;
    default:
      return NEUTRAL_EOT;
  }
}

// ---------------------------------------------------------------------------
// H. 속도(turn order) 배율
// ---------------------------------------------------------------------------

const SPEED_WEATHER: Record<string, BattleWeather> = {
  "swift-swim": "rain",
  "chlorophyll": "sun",
  "sand-rush": "sandstorm",
  "slush-rush": "hail",
};

/**
 * 날씨 의존 속도 배율.
 * - swift-swim(비)/chlorophyll(햇살)/sand-rush(모래바람)/slush-rush(우박): ×2
 * 미특성/미지원/날씨 불일치면 1.
 */
export function getAbilitySpeedMultiplier(mon: AbilityHolder, weather: BattleWeather | undefined): number {
  const ability = getAbility(mon);
  if (!ability) return 1;
  return SPEED_WEATHER[ability] === weather && weather ? 2 : 1;
}

// ---------------------------------------------------------------------------
// I. 일격 생존(sturdy)
// ---------------------------------------------------------------------------

/**
 * sturdy: 풀피(atFullHp)에서 일격사를 HP 1로 버틴다.
 * 미특성/미지원/비풀피면 false. 틀깨기(breakMold) 공격이면 무시된다.
 */
export function abilitySurvivesKO(defender: AbilityHolder, atFullHp: boolean, breakMold = false): boolean {
  if (breakMold) return false;
  return getAbility(defender) === "sturdy" && atFullHp;
}

// ---------------------------------------------------------------------------
// J. 틀깨기(mold-breaker) — 공격자가 방어 특성을 무시
// ---------------------------------------------------------------------------

const MOLD_BREAKERS = new Set<string>(["mold-breaker", "turboblaze", "teravolt"]);

/**
 * 공격자가 상대 방어 특성을 무시하는지(틀깨기/터보블레이즈/테라볼티지).
 * true면 checkAbilityImmunity/getAbilityDefenseMultiplier/abilitySurvivesKO/
 * wonder-guard/disguise의 방어 판정이 모두 스킵된다.
 */
export function attackerBreaksMold(attacker: AbilityHolder): boolean {
  const ability = getAbility(attacker);
  return ability != null && MOLD_BREAKERS.has(ability);
}

// ---------------------------------------------------------------------------
// K. 원더가드(wonder-guard) — 효과가 굉장한 데미지 기술만 통한다
// ---------------------------------------------------------------------------

/**
 * wonder-guard 보유자는 "효과가 굉장(super-effective)"한 데미지 기술에만 데미지를 입는다.
 * 그 외 데미지 기술(보통·반감·무효)은 데미지 0. status 기술은 대상이 아니다(데미지 없음).
 * 효과 판정은 데미지 계산 후에만 알 수 있으므로 방어 배율처럼 데미지 계산 뒤에 적용한다.
 * 반환 true면 호출부가 데미지를 0으로 만들고 접촉/2차효과/풀죽음을 스킵한다.
 * 미특성/미지원/틀깨기면 false(정상 데미지).
 */
export function abilityNullifiesNonSuperEffective(
  defender: AbilityHolder,
  moveCategory: MoveCategory,
  isSuperEffective: boolean,
  breakMold = false,
): boolean {
  if (breakMold) return false;
  if (moveCategory === "status") return false;
  return getAbility(defender) === "wonder-guard" && !isSuperEffective;
}

// ---------------------------------------------------------------------------
// L. 매직가드(magic-guard) — 직접 공격 외 데미지 무효
// ---------------------------------------------------------------------------

/**
 * magic-guard 보유자는 직접 공격(기술 데미지)을 제외한 간접 데미지를 전혀 받지 않는다.
 * (독/화상 도트, 날씨 도트, 씨뿌리기/조이기, 반동, 생명의구슬, 철가시/까칠한피부 등)
 * 호출부가 각 간접 데미지 적용 직전에 검사해 스킵한다. 미특성/미지원이면 false.
 */
export function abilityBlocksIndirectDamage(mon: AbilityHolder): boolean {
  return getAbility(mon) === "magic-guard";
}

// ---------------------------------------------------------------------------
// M. 배짱없음(unaware) — 상대 스탯 랭크 무시
// ---------------------------------------------------------------------------

/**
 * unaware 보유자는 데미지 계산에서 상대의 관련 스탯 랭크를 무시한다.
 * - 방어 시(내가 unaware): 공격자의 공격/특수공격 랭크를 무시 → 공격자 offensive 랭크를 0으로.
 * - 공격 시(내가 unaware): 상대의 방어/특수방어 랭크를 무시 → 방어자 defensive 랭크를 0으로.
 * 명중/회피 랭크는 별개 계산이라 건드리지 않는다. 랭크가 없거나 특성이 없으면 원본을 그대로 반환.
 *
 * offenderStages는 공격자 랭크, defenderStages는 방어자 랭크. 반환은 [보정된 공격랭크, 보정된 방어랭크].
 * 미특성/미지원이면 입력 참조를 그대로 반환(byte-identical).
 */
export function resolveUnawareStages(
  attacker: AbilityHolder,
  defender: AbilityHolder,
  attackerStages: StatStages | undefined,
  defenderStages: StatStages | undefined,
): { attackerStages: StatStages | undefined; defenderStages: StatStages | undefined } {
  const attackerUnaware = getAbility(attacker) === "unaware";
  const defenderUnaware = getAbility(defender) === "unaware";
  if (!attackerUnaware && !defenderUnaware) {
    return { attackerStages, defenderStages };
  }

  let outAttacker = attackerStages;
  let outDefender = defenderStages;

  // 방어자가 unaware → 공격자의 공격/특공 랭크 무시.
  if (defenderUnaware && attackerStages) {
    outAttacker = { ...attackerStages, attack: 0, spAttack: 0 };
  }
  // 공격자가 unaware → 방어자의 방어/특방 랭크 무시.
  if (attackerUnaware && defenderStages) {
    outDefender = { ...defenderStages, defense: 0, spDefense: 0 };
  }

  return { attackerStages: outAttacker, defenderStages: outDefender };
}

// ---------------------------------------------------------------------------
// N. 심술꾸러기(contrary) — 자신에 대한 랭크 변화가 반대로
// ---------------------------------------------------------------------------

/**
 * contrary 보유자에게 적용되는 스탯 랭크 변화는 부호가 반전된다(+는 −, −는 +).
 * 호출부(maybeApplyStatChanges/스위치인)가 "이 변화가 mon에게 적용될 때" change에 이 함수를 통과시킨다.
 * 미특성/미지원이면 change를 그대로 반환.
 */
export function applyContraryToChange(mon: AbilityHolder, change: number): number {
  return getAbility(mon) === "contrary" ? -change : change;
}

// ---------------------------------------------------------------------------
// O. 탈(disguise) — 첫 데미지 1회 무효 + 파괴 시 자가 도트
// ---------------------------------------------------------------------------

export interface DisguiseBreakResult {
  broke: boolean;         // 이번 타격에서 탈이 깨졌는지(=데미지 0 처리 대상)
  chipDamage: number;     // 탈이 깨질 때 자신이 받는 도트(maxHp/8)
}

const NEUTRAL_DISGUISE: DisguiseBreakResult = { broke: false, chipDamage: 0 };

/**
 * disguise(탈): 아직 탈이 멀쩡한 disguise 보유자가 데미지 기술(물리/특수, damage>0)에
 * 처음 맞을 때 그 타격을 무효(데미지 0)로 만들고 탈을 깬다. 배틀당 1회.
 * 깨질 때 modern-gen 사양으로 maxHp/8 자가 도트를 받는다(호출부가 적용). broke=true면
 * 호출부는 데미지를 0으로 두고 접촉/2차효과/풀죽음을 스킵해야 한다.
 *
 * alreadyBusted = 이 개체의 탈이 이미 깨졌는지(BattleState 플래그). 틀깨기(breakMold)면 무시.
 * status 기술이거나 damage<=0이면 발동 안 함(탈 유지).
 */
export function checkDisguiseBreak(
  defender: AbilityHolder,
  moveCategory: MoveCategory,
  incomingDamage: number,
  alreadyBusted: boolean,
  maxHp: number,
  breakMold = false,
): DisguiseBreakResult {
  if (breakMold) return NEUTRAL_DISGUISE;
  if (alreadyBusted) return NEUTRAL_DISGUISE;
  if (moveCategory === "status") return NEUTRAL_DISGUISE;
  if (incomingDamage <= 0) return NEUTRAL_DISGUISE;
  if (getAbility(defender) !== "disguise") return NEUTRAL_DISGUISE;
  return { broke: true, chipDamage: Math.max(1, Math.floor(maxHp / 8)) };
}
