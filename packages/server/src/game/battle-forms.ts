import type { BattleWeather } from "../../../../shared/types.js";

export interface FormChangeResult {
  newForm: string | null;
  message: string;
}

/**
 * Check form changes after an attack (aegislash stance change).
 * physical/special attack -> blade, status move (king's shield) -> shield
 */
export function checkPostAttackForm(
  species: string,
  moveCategory: string,
  variantId: string | null,
): FormChangeResult | null {
  if (species !== "aegislash") return null;

  if (moveCategory === "physical" || moveCategory === "special") {
    // Already in blade form
    if (variantId === "aegislash-blade") return null;
    return { newForm: "aegislash-blade", message: "칼바꿈을 했다! (블레이드 폼)" };
  }
  if (moveCategory === "status") {
    // Already in shield form (base)
    if (variantId === null || variantId === "aegislash") return null;
    return { newForm: null, message: "방패바꿈을 했다! (실드 폼)" };
  }
  return null;
}

/**
 * Check form changes after HP change (wishiwashi, minior, darmanitan, zygarde).
 */
export function checkHpThresholdForm(
  species: string,
  hp: number,
  maxHp: number,
  level: number,
  variantId: string | null,
): FormChangeResult | null {
  const hpRatio = hp / maxHp;

  if (species === "wishiwashi") {
    if (hpRatio > 0.25 && level >= 20) {
      if (variantId === "wishiwashi-school") return null;
      return { newForm: "wishiwashi-school", message: "무리를 불러모았다! (군집 폼)" };
    }
    // Solo form (base)
    if (variantId === null || variantId === "wishiwashi") return null;
    return { newForm: null, message: "무리가 흩어졌다! (단독 폼)" };
  }

  if (species === "minior") {
    if (hpRatio <= 0.5) {
      // Core form — if already in core form, no change
      if (variantId === "minior-core") return null;
      return { newForm: "minior-core", message: "껍질이 깨졌다! (코어 폼)" };
    }
    // Meteor form (base, null)
    if (variantId === null || variantId === "minior") return null;
    return { newForm: null, message: "껍질을 복구했다! (메테오 폼)" };
  }

  if (species === "darmanitan") {
    if (hpRatio <= 0.5) {
      if (variantId === "darmanitan-zen") return null;
      return { newForm: "darmanitan-zen", message: "젠모드로 변했다!" };
    }
    if (variantId === null || variantId === "darmanitan") return null;
    return { newForm: null, message: "일반 모드로 돌아왔다!" };
  }

  if (species === "zygarde") {
    if (hpRatio <= 0.5) {
      if (variantId === "zygarde-complete") return null;
      return { newForm: "zygarde-complete", message: "퍼펙트 폼으로 변했다!" };
    }
    // Don't revert mid-battle for zygarde (power construct stays)
    return null;
  }

  return null;
}

/**
 * Check form changes on turn start/end (morpeko alternates each turn).
 */
export function checkTurnForm(
  species: string,
  turnNumber: number,
  variantId: string | null,
): FormChangeResult | null {
  if (species !== "morpeko") return null;

  // Even turns: full-belly (base), odd turns: hangry
  const shouldBeHangry = turnNumber % 2 === 1;

  if (shouldBeHangry) {
    if (variantId === "morpeko-hangry") return null;
    return { newForm: "morpeko-hangry", message: "배고픈 모양으로 변했다!" };
  }
  if (variantId === null || variantId === "morpeko") return null;
  return { newForm: null, message: "만복 모양으로 돌아왔다!" };
}

/**
 * Check weather-based form changes (castform, cherrim).
 */
export function checkWeatherForm(
  species: string,
  weather: BattleWeather | undefined,
  variantId: string | null,
): FormChangeResult | null {
  if (species === "castform") {
    let targetForm: string | null = null;
    let formName = "노말 폼";
    if (weather === "sun") { targetForm = "castform-sunny"; formName = "태양 폼"; }
    else if (weather === "rain") { targetForm = "castform-rainy"; formName = "빗방울 폼"; }
    else if (weather === "hail") { targetForm = "castform-snowy"; formName = "눈구름 폼"; }
    // sandstorm and no-weather -> base form

    if (targetForm === variantId) return null;
    if (targetForm === null && (variantId === null || variantId === "castform")) return null;
    return { newForm: targetForm, message: `날씨캐스팅! (${formName})` };
  }

  if (species === "cherrim") {
    if (weather === "sun") {
      if (variantId === "cherrim-sunshine") return null;
      return { newForm: "cherrim-sunshine", message: "꽃이 피었다! (선샤인 폼)" };
    }
    if (variantId === null || variantId === "cherrim") return null;
    return { newForm: null, message: "꽃이 닫혔다! (오버캐스트 폼)" };
  }

  return null;
}

/**
 * Check first-hit form change (eiscue: physical hit -> noice face).
 * Mimikyu is skipped (no variant data).
 */
export function checkFirstHitForm(
  species: string,
  variantId: string | null,
  wasPhysicalHit: boolean,
): FormChangeResult | null {
  if (species === "eiscue" && wasPhysicalHit) {
    if (variantId === "eiscue-noice") return null;
    return { newForm: "eiscue-noice", message: "아이스페이스가 깨졌다! (나이스 페이스)" };
  }
  return null;
}

/**
 * Check post-surf form (cramorant).
 * After using Surf/Dive: HP>50% -> gulping, HP<=50% -> gorging.
 */
export function checkPostSurfForm(
  species: string,
  hp: number,
  maxHp: number,
): FormChangeResult | null {
  if (species !== "cramorant") return null;

  const hpRatio = hp / maxHp;
  if (hpRatio > 0.5) {
    return { newForm: "cramorant-gulping", message: "물고기를 문 채로 돌아왔다! (꿀꺽 폼)" };
  }
  return { newForm: "cramorant-gorging", message: "큰 물고기를 문 채로 돌아왔다! (통째로꿀꺽 폼)" };
}

/**
 * Check move-based form (meloetta: relic-song toggles aria/pirouette).
 */
export function checkMoveForm(
  species: string,
  moveId: string,
  variantId: string | null,
): FormChangeResult | null {
  if (species !== "meloetta") return null;
  if (moveId !== "relic-song") return null;

  if (variantId === "meloetta-pirouette") {
    return { newForm: null, message: "보이스 폼으로 변했다! (아리아 폼)" };
  }
  return { newForm: "meloetta-pirouette", message: "스텝 폼으로 변했다! (피루에트 폼)" };
}

/**
 * Get form to revert to when battle ends.
 * Returns the base form (null) for pokemon that revert, or null if no revert needed.
 * Returns undefined if the species doesn't have battle form changes.
 */
export function getBattleEndForm(species: string): string | null | undefined {
  const revertSpecies = [
    "aegislash", "morpeko", "meloetta",
    "castform", "cherrim",
    "wishiwashi", "minior", "zygarde",
    "darmanitan", "cramorant", "eiscue",
  ];
  if (revertSpecies.includes(species)) return null;
  return undefined;
}
