import type { BattleWeather } from "../../../../shared/types.js";

const WEATHER_MOVES: Record<string, BattleWeather> = {
  "sunny-day": "sun",
  "rain-dance": "rain",
  "hail": "hail",
  "sandstorm": "sandstorm",
};

const DEFAULT_WEATHER_TURNS = 5;

/** Returns the weather a move sets, or null if the move doesn't set weather. */
export function getWeatherFromMove(moveId: string): BattleWeather | null {
  return WEATHER_MOVES[moveId] ?? null;
}

/** Returns the type-based damage modifier for a given weather and move type. */
export function getWeatherTypeModifier(weather: BattleWeather, moveType: string): number {
  if (weather === "sun") {
    if (moveType === "fire") return 1.5;
    if (moveType === "water") return 0.5;
  }
  if (weather === "rain") {
    if (moveType === "water") return 1.5;
    if (moveType === "fire") return 0.5;
  }
  return 1.0;
}

/**
 * Returns end-of-turn weather chip damage.
 * Hail: 1/16 maxHp to non-ice types.
 * Sandstorm: 1/16 maxHp to non-rock/ground/steel types.
 */
export function getWeatherDamage(weather: BattleWeather, types: string[], maxHp: number): number {
  if (weather === "hail") {
    if (types.includes("ice")) return 0;
    return Math.max(1, Math.floor(maxHp / 16));
  }
  if (weather === "sandstorm") {
    if (types.includes("rock") || types.includes("ground") || types.includes("steel")) return 0;
    return Math.max(1, Math.floor(maxHp / 16));
  }
  return 0;
}

/**
 * Tick weather at end of turn. Returns updated weather/turns and whether it expired.
 * When called with undefined weather, returns expired: false and no weather.
 */
export function tickWeather(
  weather: BattleWeather | undefined,
  turns: number | undefined,
): { weather?: BattleWeather; turns?: number; expired: boolean } {
  if (!weather || turns === undefined) {
    return { weather: undefined, turns: undefined, expired: false };
  }
  const remaining = turns - 1;
  if (remaining <= 0) {
    return { weather: undefined, turns: undefined, expired: true };
  }
  return { weather, turns: remaining, expired: false };
}

/** Returns the default number of turns weather lasts. */
export function getDefaultWeatherTurns(): number {
  return DEFAULT_WEATHER_TURNS;
}
