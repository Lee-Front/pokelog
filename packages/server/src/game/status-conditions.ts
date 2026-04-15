import type { PrimaryStatus, VolatileStatus, PokemonStats } from "../../../../shared/types.js";

/** Check if a primary status can be applied (only one at a time) */
export function canApplyPrimaryStatus(current: PrimaryStatus | null | undefined): boolean {
  return !current;
}

const AILMENT_TO_PRIMARY: Record<string, PrimaryStatus> = {
  poison: "poison",
  burn: "burn",
  paralysis: "paralysis",
  sleep: "sleep",
  freeze: "freeze",
};

const VOLATILE_AILMENTS = new Set([
  "confusion",
  "trap",
  "leech-seed",
  "infatuation",
  "disable",
  "nightmare",
  "yawn",
  "torment",
  "embargo",
  "heal-block",
  "ingrain",
  "perish-song",
]);

/** Apply ailment from move data. Returns the status to apply or null */
export function rollAilment(
  ailment: string,
  chance: number,
  currentStatus: PrimaryStatus | null | undefined,
): PrimaryStatus | null {
  if (!ailment || ailment === "none") return null;

  // Roll the chance
  // "skip if over": roll >= chance means the ailment does NOT apply
  if (chance > 0 && chance < 100) {
    if (Math.random() * 100 >= chance) return null;
  }

  const primary = AILMENT_TO_PRIMARY[ailment];
  if (primary) {
    if (!canApplyPrimaryStatus(currentStatus)) return null;
    return primary;
  }

  // Volatile ailments are handled separately via addVolatile in the caller
  return null;
}

/** Check if the ailment is a volatile type */
export function isVolatileAilment(ailment: string): boolean {
  return VOLATILE_AILMENTS.has(ailment);
}

/** Pre-attack check: returns { canAct, message, selfDamage?, statusCleared? } */
export function checkPreAttack(
  status: PrimaryStatus | null | undefined,
  volatiles: VolatileStatus[],
  stats: PokemonStats,
  level: number,
): { canAct: boolean; message: string; selfDamage?: number; statusCleared?: PrimaryStatus } {
  // Sleep check
  if (status === "sleep") {
    // sleepTurns is managed externally. Caller should check sleepTurns.
    // If sleepTurns reaches 0, the caller sets canAct=true by clearing status before calling.
    // But we still need to handle it: the caller decrements sleepTurns BEFORE calling this.
    // Convention: if status is still "sleep" when this is called, the pokemon is still sleeping.
    return { canAct: false, message: "쿨쿨 자고있다..." };
  }

  // Freeze check: 20% thaw chance
  if (status === "freeze") {
    if (Math.random() < 0.2) {
      return { canAct: true, message: "얼음이 풀렸다!", statusCleared: "freeze" };
    }
    return { canAct: false, message: "얼어붙어 움직일 수 없다!" };
  }

  // Paralysis check: 25% skip
  if (status === "paralysis") {
    if (Math.random() < 0.25) {
      return { canAct: false, message: "몸이 마비되어 움직일 수 없다!" };
    }
  }

  // Confusion check
  const confusion = volatiles.find((v) => v.id === "confusion");
  if (confusion) {
    if (Math.random() < 0.33) {
      // Self-damage using 40 power physical formula
      // damage = ((2*level/5+2) * 40 * atk / def) / 50 + 2
      const selfDamage = Math.max(1, Math.floor(
        ((2 * level / 5 + 2) * 40 * stats.attack / stats.defense) / 50 + 2,
      ));
      return { canAct: false, message: "혼란에 빠져 자신을 공격했다!", selfDamage };
    }
  }

  // Infatuation check
  const infatuation = volatiles.find((v) => v.id === "infatuation");
  if (infatuation) {
    if (Math.random() < 0.5) {
      return { canAct: false, message: "사랑에 빠져 움직일 수 없다!" };
    }
  }

  return { canAct: true, message: "" };
}

/** End-of-turn effects: returns { damage, healing, opponentHealing, messages } */
export function applyEndOfTurn(
  status: PrimaryStatus | null | undefined,
  volatiles: VolatileStatus[],
  maxHp: number,
  opponentMaxHp: number,
): { damage: number; healing: number; opponentHealing: number; messages: string[] } {
  let damage = 0;
  let healing = 0;
  let opponentHealing = 0;
  const messages: string[] = [];

  // Poison: maxHp / 8
  if (status === "poison") {
    const poisonDmg = Math.max(1, Math.floor(maxHp / 8));
    damage += poisonDmg;
    messages.push("독 데미지를 받았다!");
  }

  // Burn: maxHp / 16
  if (status === "burn") {
    const burnDmg = Math.max(1, Math.floor(maxHp / 16));
    damage += burnDmg;
    messages.push("화상 데미지를 받았다!");
  }

  // Trap: maxHp / 8
  if (hasVolatile(volatiles, "trap")) {
    const trapDmg = Math.max(1, Math.floor(maxHp / 8));
    damage += trapDmg;
    messages.push("조이기 데미지를 받았다!");
  }

  // Leech seed: maxHp / 8 drain (opponent heals)
  if (hasVolatile(volatiles, "leech-seed")) {
    const leechDmg = Math.max(1, Math.floor(maxHp / 8));
    damage += leechDmg;
    opponentHealing += leechDmg;
    messages.push("씨뿌리기로 체력을 빼앗겼다!");
  }

  // Nightmare: maxHp / 4 (only if sleeping)
  if (status === "sleep" && hasVolatile(volatiles, "nightmare")) {
    const nightmareDmg = Math.max(1, Math.floor(maxHp / 4));
    damage += nightmareDmg;
    messages.push("악몽에 시달리고 있다!");
  }

  // Ingrain: maxHp / 16 recovery
  if (hasVolatile(volatiles, "ingrain")) {
    const ingrainHeal = Math.max(1, Math.floor(maxHp / 16));
    healing += ingrainHeal;
    messages.push("뿌리로 체력을 회복했다!");
  }

  return { damage, healing, opponentHealing, messages };
}

/** Tick volatile statuses: decrement turns, remove expired */
export function tickVolatiles(volatiles: VolatileStatus[]): VolatileStatus[] {
  return volatiles
    .map((v) => ({
      ...v,
      turnsRemaining: v.turnsRemaining > 0 ? v.turnsRemaining - 1 : v.turnsRemaining,
    }))
    .filter((v) => v.turnsRemaining !== 0);
}

/** Check if a volatile status exists */
export function hasVolatile(volatiles: VolatileStatus[], id: string): boolean {
  return volatiles.some((v) => v.id === id);
}

/** Add a volatile status (if not already present) */
export function addVolatile(volatiles: VolatileStatus[], id: string, turns: number): VolatileStatus[] {
  if (hasVolatile(volatiles, id)) return volatiles;
  return [...volatiles, { id, turnsRemaining: turns }];
}

/** Get random sleep turns (1-3) */
export function rollSleepTurns(): number {
  return 1 + Math.floor(Math.random() * 3);
}

/** Get random confusion turns (1-4) */
export function rollConfusionTurns(): number {
  return 1 + Math.floor(Math.random() * 4);
}

/** Get random trap turns (4-5) */
export function rollTrapTurns(): number {
  return 4 + Math.floor(Math.random() * 2);
}
