/**
 * PvP Held Item Effects Framework
 *
 * Provides a registry of held item effects and hook functions that pvp-room.ts
 * calls at the appropriate points during battle resolution.
 */
import type {
  PvpRoomState, PvpPlayerState, PvpPokemon,
} from "../../../../shared/pvp-types.js";
import type { MoveData } from "../../../../shared/types.js";
import { applyStatChanges } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";
import { getTypeChart } from "../game/data-loader.js";

// ── Hook Context Types ──

export interface ItemDamageContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;
  damage: number;
}

export interface ItemAfterAttackContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;
  damage: number;
}

export interface ItemAfterBeingHitContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;
  damage: number;
}

export interface ItemEndOfTurnContext {
  room: PvpRoomState;
  player: PvpPlayerState;
  opponent: PvpPlayerState;
  pokemon: PvpPokemon;
}

export interface ItemPreventKOContext {
  room: PvpRoomState;
  defender: PvpPlayerState;
  defPoke: PvpPokemon;
  damage: number;
}

// ── Item Effects Interface ──

export interface ItemEffects {
  /** Attack multiplier when this pokemon attacks. Default: 1. */
  onAttack?: (ctx: ItemDamageContext) => number;

  /** Defense multiplier when this pokemon defends. Default: 1. */
  onDefense?: (ctx: ItemDamageContext) => number;

  /** After dealing damage (life-orb recoil, shell-bell heal). */
  afterAttack?: (ctx: ItemAfterAttackContext) => void;

  /** After taking damage (rocky-helmet, sitrus-berry, weakness-policy). */
  afterBeingHit?: (ctx: ItemAfterBeingHitContext) => void;

  /** End of turn effects (leftovers, flame-orb). */
  onEndOfTurn?: (ctx: ItemEndOfTurnContext) => void;

  /** Speed modifier. Returns modified speed value. */
  modifySpeed?: (speed: number, pokemon: PvpPokemon) => number;

  /** Survive lethal damage with 1 HP (focus-sash). Return true if prevented. */
  preventKO?: (ctx: ItemPreventKOContext) => boolean;

  /** Whether this item locks the pokemon into the first move used (choice items). */
  lockMove?: boolean;
}

// ── Registry ──

const registry = new Map<string, ItemEffects>();

/** Register item effects for a given item ID. */
export function register(itemId: string, effects: ItemEffects): void {
  registry.set(itemId, effects);
}

/** Get registered effects for an item (or undefined if not registered). */
export function getEffects(itemId: string): ItemEffects | undefined {
  return registry.get(itemId);
}

// ── Public API Functions ──

/**
 * Get the attack multiplier from the attacker's held item.
 * Returns 1 if no item or no onAttack hook registered.
 */
export function getItemAttackMultiplier(ctx: ItemDamageContext): number {
  const itemId = ctx.atkPoke.heldItem;
  if (!itemId) return 1;
  const effects = registry.get(itemId);
  if (!effects?.onAttack) return 1;
  return effects.onAttack(ctx);
}

/**
 * Get the defense multiplier from the defender's held item.
 * Returns 1 if no item or no onDefense hook registered.
 */
export function getItemDefenseMultiplier(ctx: ItemDamageContext): number {
  const itemId = ctx.defPoke.heldItem;
  if (!itemId) return 1;
  const effects = registry.get(itemId);
  if (!effects?.onDefense) return 1;
  return effects.onDefense(ctx);
}

/**
 * Trigger after-attack effects for the attacker's held item.
 */
export function triggerAfterAttack(ctx: ItemAfterAttackContext): void {
  const itemId = ctx.atkPoke.heldItem;
  if (!itemId) return;
  const effects = registry.get(itemId);
  effects?.afterAttack?.(ctx);
}

/**
 * Trigger after-being-hit effects for the defender's held item.
 */
export function triggerAfterBeingHit(ctx: ItemAfterBeingHitContext): void {
  const itemId = ctx.defPoke.heldItem;
  if (!itemId) return;
  const effects = registry.get(itemId);
  effects?.afterBeingHit?.(ctx);
}

/**
 * Trigger end-of-turn effects for the pokemon's held item.
 */
export function triggerItemEndOfTurn(ctx: ItemEndOfTurnContext): void {
  const itemId = ctx.pokemon.heldItem;
  if (!itemId) return;
  const effects = registry.get(itemId);
  effects?.onEndOfTurn?.(ctx);
}

/**
 * Get effective speed, modified by the pokemon's held item.
 */
export function getItemSpeedMultiplier(speed: number, pokemon: PvpPokemon): number {
  const itemId = pokemon.heldItem;
  if (!itemId) return speed;
  const effects = registry.get(itemId);
  if (!effects?.modifySpeed) return speed;
  return effects.modifySpeed(speed, pokemon);
}

/**
 * Check if the defender's held item prevents a KO.
 * Returns true if the item prevented the KO (caller should set HP to 1 and consume item).
 */
export function checkItemPreventKO(ctx: ItemPreventKOContext): boolean {
  const itemId = ctx.defPoke.heldItem;
  if (!itemId) return false;
  const effects = registry.get(itemId);
  if (!effects?.preventKO) return false;
  return effects.preventKO(ctx);
}

/**
 * Check if the pokemon's held item has lockMove enabled.
 */
export function isItemLockMove(pokemon: PvpPokemon): boolean {
  const itemId = pokemon.heldItem;
  if (!itemId) return false;
  const effects = registry.get(itemId);
  return effects?.lockMove ?? false;
}

// ── Helper: check super-effectiveness ──

function isSuperEffective(moveType: string, defPoke: PvpPokemon, defPlayer: PvpPlayerState): boolean {
  const typeChart = getTypeChart();
  const defTypes = getEffectiveTypes(defPoke.species, defPoke.variantId, defPlayer.battleForm);
  let mult = 1;
  for (const t of defTypes) {
    mult *= (typeChart[moveType]?.[t] ?? 1);
  }
  return mult > 1;
}

// ══════════════════════════════════════════════════════════════
// ── Item Registrations ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════

// ── Damage Boosters ──

register("life-orb", {
  onAttack: () => 1.3,
  afterAttack: (ctx) => {
    if (ctx.damage > 0 && ctx.atkPoke.hp > 0) {
      const recoil = Math.max(1, Math.floor(ctx.atkPoke.maxHp / 10));
      ctx.atkPoke.hp = Math.max(0, ctx.atkPoke.hp - recoil);
      ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 생명의구슬 반동으로 ${recoil} 데미지!`);
    }
  },
});

register("choice-band", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 1.5 : 1,
  lockMove: true,
});

register("choice-specs", {
  onAttack: (ctx) => ctx.move.category === "special" ? 1.5 : 1,
  lockMove: true,
});

register("expert-belt", {
  onAttack: (ctx) => isSuperEffective(ctx.move.type, ctx.defPoke, ctx.defender) ? 1.2 : 1,
});

register("muscle-band", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 1.1 : 1,
});

register("wise-glasses", {
  onAttack: (ctx) => ctx.move.category === "special" ? 1.1 : 1,
});

// ── Defensive Items ──

register("assault-vest", {
  onDefense: (ctx) => ctx.move.category === "special" ? 0.67 : 1,
});

register("eviolite", {
  onDefense: () => 0.67,
});

register("rocky-helmet", {
  afterBeingHit: (ctx) => {
    if (ctx.move.category === "physical" && ctx.damage > 0 && ctx.atkPoke.hp > 0) {
      const helmDmg = Math.max(1, Math.floor(ctx.atkPoke.maxHp / 6));
      ctx.atkPoke.hp = Math.max(0, ctx.atkPoke.hp - helmDmg);
      ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 울퉁불퉁멧 반동으로 ${helmDmg} 데미지!`);
    }
  },
});

// ── Survival / Recovery Items ──

register("focus-sash", {
  preventKO: (ctx) => {
    if (ctx.defPoke.hp >= ctx.defPoke.maxHp) {
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 기합의띠로 버텨냈다!`);
      return true;
    }
    return false;
  },
});

register("leftovers", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp > 0 && ctx.pokemon.hp < ctx.pokemon.maxHp) {
      const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 16));
      ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
      ctx.room.log.push(`${ctx.player.nickname}의 ${ctx.pokemon.species}: 먹다남은음식으로 HP 회복!`);
    }
  },
});

register("black-sludge", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp <= 0) return;
    const types = getEffectiveTypes(ctx.pokemon.species, ctx.pokemon.variantId, ctx.player.battleForm);
    if (types.includes("poison")) {
      if (ctx.pokemon.hp < ctx.pokemon.maxHp) {
        const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 16));
        ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
        ctx.room.log.push(`${ctx.player.nickname}의 ${ctx.pokemon.species}: 검은진흙으로 HP 회복!`);
      }
    } else {
      const dmg = Math.max(1, Math.floor(ctx.pokemon.maxHp / 8));
      ctx.pokemon.hp = Math.max(0, ctx.pokemon.hp - dmg);
      ctx.room.log.push(`${ctx.player.nickname}의 ${ctx.pokemon.species}: 검은진흙으로 ${dmg} 데미지!`);
    }
  },
});

register("shell-bell", {
  afterAttack: (ctx) => {
    if (ctx.damage > 0 && ctx.atkPoke.hp > 0) {
      const heal = Math.max(1, Math.floor(ctx.damage / 8));
      ctx.atkPoke.hp = Math.min(ctx.atkPoke.maxHp, ctx.atkPoke.hp + heal);
      ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 조개껍질방울로 HP 회복!`);
    }
  },
});

register("sitrus-berry", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.hp > 0 && ctx.defPoke.hp <= ctx.defPoke.maxHp / 2 && ctx.defPoke.heldItem === "sitrus-berry") {
      const heal = Math.max(1, Math.floor(ctx.defPoke.maxHp / 4));
      ctx.defPoke.hp = Math.min(ctx.defPoke.maxHp, ctx.defPoke.hp + heal);
      ctx.defPoke.heldItem = null; // consumed
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 자뭉열매로 HP 회복!`);
    }
  },
});

// ── Speed / Status / Utility Items ──

register("choice-scarf", {
  modifySpeed: (speed) => Math.floor(speed * 1.5),
  lockMove: true,
});

register("iron-ball", {
  modifySpeed: (speed) => Math.floor(speed * 0.5),
});

register("flame-orb", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp > 0 && !ctx.pokemon.statusCondition) {
      ctx.pokemon.statusCondition = "burn";
      ctx.room.log.push(`${ctx.player.nickname}의 ${ctx.pokemon.species}: 화염구슬로 화상 상태가 되었다!`);
    }
  },
});

register("toxic-orb", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.hp > 0 && !ctx.pokemon.statusCondition) {
      ctx.pokemon.statusCondition = "poison";
      ctx.pokemon.toxicCounter = 1;
      ctx.room.log.push(`${ctx.player.nickname}의 ${ctx.pokemon.species}: 독독구슬로 맹독 상태가 되었다!`);
    }
  },
});

register("weakness-policy", {
  afterBeingHit: (ctx) => {
    if (ctx.damage > 0 && ctx.defPoke.hp > 0 && ctx.defPoke.heldItem === "weakness-policy") {
      if (isSuperEffective(ctx.move.type, ctx.defPoke, ctx.defender)) {
        ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [
          { stat: "attack", change: 2 },
          { stat: "spAttack", change: 2 },
        ]);
        ctx.defPoke.heldItem = null; // consumed
        ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 약점보험 발동! 공격과 특수공격이 올랐다!`);
      }
    }
  },
});

register("lum-berry", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.hp > 0 && ctx.defPoke.statusCondition && ctx.defPoke.heldItem === "lum-berry") {
      const cured = ctx.defPoke.statusCondition;
      ctx.defPoke.statusCondition = null;
      ctx.defPoke.sleepTurns = undefined;
      ctx.defPoke.toxicCounter = undefined;
      ctx.defPoke.heldItem = null; // consumed
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 리무열매로 상태이상 회복!`);
    }
  },
});

register("heavy-duty-boots", {
  // Placeholder for Plan D hazards — no effects yet
});
