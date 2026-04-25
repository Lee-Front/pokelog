import type { OwnedPokemon } from "../../../../shared/types.js";
import { getSpeciesByName } from "./data-loader.js";

/**
 * Friendship accumulation events. The deltas roughly follow canon Gen 6+
 * happiness mechanics, scaled down because pokelog has no
 * walking/steps/massage/etc. — we accumulate friendship only on the
 * actions that already exist in the game.
 */
export type FriendshipEvent =
  | "level-up"
  | "vitamin"
  | "heal-item"
  | "pve-win"
  | "pvp-win"
  | "tower-clear"
  | "faint"
  | "trade-received";

const DELTAS: Record<FriendshipEvent, number> = {
  "level-up": 5,
  "vitamin": 5,
  "heal-item": 1,
  "pve-win": 1,
  "pvp-win": 2,
  "tower-clear": 3,
  "faint": -5,
  // Trade-received is a reset rather than a delta — handled inline below.
  "trade-received": 0,
};

export const FRIENDSHIP_MIN = 0;
export const FRIENDSHIP_MAX = 255;
export const FRIENDSHIP_DEFAULT = 70;

/**
 * Mutate `pokemon.friendship` for the given event and return the new
 * value. `trade-received` resets friendship to the species' baseHappiness
 * (canon: receiving a traded pokemon resets familiarity). All other
 * events apply a clamped delta in [0, 255].
 */
export function adjustFriendship(pokemon: OwnedPokemon, event: FriendshipEvent): number {
  const current = pokemon.friendship ?? FRIENDSHIP_DEFAULT;

  if (event === "trade-received") {
    const species = getSpeciesByName(pokemon.species);
    const reset = species?.baseHappiness ?? FRIENDSHIP_DEFAULT;
    pokemon.friendship = reset;
    return reset;
  }

  const delta = DELTAS[event] ?? 0;
  const newValue = Math.max(FRIENDSHIP_MIN, Math.min(FRIENDSHIP_MAX, current + delta));
  pokemon.friendship = newValue;
  return newValue;
}

/**
 * Apply a friendship event to every pokemon in `pokemon` whose HP is > 0
 * (skipping fainted members). Used for party-wide rewards like PvP wins
 * and tower stage clears.
 */
export function adjustFriendshipBulk(pokemon: OwnedPokemon[], event: FriendshipEvent): void {
  for (const member of pokemon) {
    if (member.hp > 0) {
      adjustFriendship(member, event);
    }
  }
}
