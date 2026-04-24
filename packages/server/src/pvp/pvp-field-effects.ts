/**
 * Field-effect helpers extracted from pvp-room.ts.
 *
 * These functions are pure/stateless utilities operating on a `PvpRoomState`
 * or `PvpPlayerState` — no module-level state of their own. They were split
 * out to keep pvp-room.ts focused on orchestration.
 *
 * Scope:
 *  - Type/grounded checks (`isGrounded`)
 *  - Item availability under Magic Room / Embargo (`effectiveHeldItem`)
 *  - Move/terrain/hazard lookup tables (`POWDER_MOVES`, `HAZARD_MOVES`,
 *    `TERRAIN_NAMES`)
 *  - Entry-hazard damage on switch-in (`applyHazardDamage`)
 */
import { getEffectiveTypes } from "../game/pokemon-state.js";
import { getTypeChart } from "../game/data-loader.js";
import { applyStatChanges } from "../game/battle.js";
import { hasVolatile } from "../game/status-conditions.js";
import type {
  PvpRoomState, PvpPlayerState, PvpPokemon,
} from "../../../../shared/pvp-types.js";

export const POWDER_MOVES = new Set([
  "sleep-powder", "stun-spore", "poison-powder", "spore",
  "cotton-spore", "rage-powder", "powder",
]);

export const HAZARD_MOVES: Record<string, (hazards: NonNullable<PvpPlayerState["hazards"]>) => boolean> = {
  "stealth-rock": (h) => { if (h.stealthRock) return false; h.stealthRock = true; return true; },
  "spikes": (h) => { if ((h.spikes ?? 0) >= 3) return false; h.spikes = (h.spikes ?? 0) + 1; return true; },
  "toxic-spikes": (h) => { if ((h.toxicSpikes ?? 0) >= 2) return false; h.toxicSpikes = (h.toxicSpikes ?? 0) + 1; return true; },
  "sticky-web": (h) => { if (h.stickyWeb) return false; h.stickyWeb = true; return true; },
};

export const TERRAIN_NAMES: Record<string, string> = {
  electric: "일렉트릭필드",
  grassy: "그래스필드",
  psychic: "사이코필드",
  misty: "미스트필드",
};

/**
 * Whether a pokemon counts as grounded (susceptible to ground moves, grounded
 * hazards, and terrain effects). Iron Ball always grounds; Air Balloon
 * always ungrounds; otherwise Flying-type or Levitate ability floats.
 */
export function isGrounded(poke: PvpPokemon, player: PvpPlayerState): boolean {
  // Iron Ball always grounds the pokemon (beats flying type / levitate).
  if (poke.heldItem === "iron-ball") return true;
  if (poke.heldItem === "air-balloon") return false;
  const types = getEffectiveTypes(poke.species, poke.variantId, player.battleForm);
  return !types.includes("flying") && poke.abilityId !== "levitate";
}

/**
 * Check whether a pokemon's held item is currently active.
 * Returns null if items are disabled via Magic Room or Embargo.
 */
export function effectiveHeldItem(poke: PvpPokemon, player: PvpPlayerState, room: PvpRoomState): string | null {
  if (room.magicRoom && room.magicRoom > 0) return null;
  if (hasVolatile(player.volatiles, "embargo")) return null;
  return poke.heldItem ?? null;
}

/**
 * Apply entry-hazard damage/effects to `pokemon` on switch-in to `player`'s
 * side. Stealth Rock uses rock-type effectiveness vs current types; Spikes
 * and Toxic Spikes only hit grounded; Sticky Web drops grounded speed.
 *
 * Heavy-Duty Boots skips all hazards.
 */
export function applyHazardDamage(room: PvpRoomState, player: PvpPlayerState, pokemon: PvpPokemon): void {
  const hazards = player.hazards;
  if (!hazards || pokemon.heldItem === "heavy-duty-boots") return;

  const types = getEffectiveTypes(pokemon.species, pokemon.variantId, player.battleForm);

  // Stealth Rock: type-effectiveness-based damage (rock vs pokemon types), base 1/8 maxHp
  if (hazards.stealthRock) {
    const typeChart = getTypeChart();
    let mult = 1;
    for (const t of types) mult *= (typeChart["rock"]?.[t] ?? 1);
    const dmg = Math.max(1, Math.floor(pokemon.maxHp * mult / 8));
    pokemon.hp = Math.max(0, pokemon.hp - dmg);
    room.log.push(`스텔스록 데미지! ${dmg}!`);
  }

  // Spikes: grounded only, 1/8, 1/6, 1/4 by layers
  if (hazards.spikes && hazards.spikes > 0) {
    if (isGrounded(pokemon, player)) {
      const fractions = [0, 1 / 8, 1 / 6, 1 / 4];
      const dmg = Math.max(1, Math.floor(pokemon.maxHp * (fractions[hazards.spikes] ?? 0)));
      pokemon.hp = Math.max(0, pokemon.hp - dmg);
      room.log.push(`압정 데미지! ${dmg}!`);
    }
  }

  // Toxic Spikes: grounded only, poison types absorb, steel types immune
  if (hazards.toxicSpikes && hazards.toxicSpikes > 0) {
    if (isGrounded(pokemon, player)) {
      if (types.includes("poison")) {
        hazards.toxicSpikes = 0;
        room.log.push(`${pokemon.species}이(가) 독압정을 흡수했다!`);
      } else if (types.includes("steel")) {
        // Steel types: immune to toxic spikes poisoning but don't absorb them.
      } else if (!pokemon.statusCondition) {
        if (hazards.toxicSpikes >= 2) {
          pokemon.statusCondition = "poison";
          pokemon.toxicCounter = 1;
          room.log.push(`${pokemon.species}: 맹독에 걸렸다!`);
        } else {
          pokemon.statusCondition = "poison";
          room.log.push(`${pokemon.species}: 독에 걸렸다!`);
        }
      }
    }
  }

  // Sticky Web: grounded only, speed -1
  if (hazards.stickyWeb) {
    if (isGrounded(pokemon, player)) {
      player.statStages = applyStatChanges(player.statStages, [{ stat: "speed", change: -1 }]);
      room.log.push(`끈적끈적네트! ${pokemon.species}의 스피드가 내려갔다!`);
    }
  }
}
