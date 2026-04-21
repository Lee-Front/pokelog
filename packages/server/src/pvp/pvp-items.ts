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

  /** Allow switching even when trapped (Shed Shell). */
  bypassTrap?: boolean;

  /** Forces the holder to always move last (Lagging Tail, Full Incense). */
  alwaysLast?: boolean;

  /** 20% chance to gain +1 priority (Quick Claw). */
  quickClaw?: boolean;

  /** Immune to weather effects (Utility Umbrella). */
  weatherImmune?: boolean;

  /** Immune to powder moves (Safety Goggles). */
  powderImmune?: boolean;
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

/** Alias for getEffects. */
export function getItemEffects(itemId: string): ItemEffects | undefined {
  return registry.get(itemId);
}

/** Return true if the held item has the given boolean flag set. */
export function hasItemFlag(
  pokemon: PvpPokemon,
  flag: "bypassTrap" | "alwaysLast" | "quickClaw" | "weatherImmune" | "powderImmune",
): boolean {
  const itemId = pokemon.heldItem;
  if (!itemId) return false;
  const effects = registry.get(itemId);
  return Boolean(effects?.[flag]);
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

// ══════════════════════════════════════════════════════════════
// ── Batch 3: Additional Items ───────────────────────────────
// ══════════════════════════════════════════════════════════════

// ── Utility / Defense Items ──
register("safety-goggles", { powderImmune: true });  // weather tick handled in pvp-room.ts
register("protective-pads", {});        // handled in pvp-room.ts contact-ability block
register("covert-cloak", {});           // handled in pvp-room.ts secondary effects
register("clear-amulet", {});           // handled in pvp-room.ts stat-drop block
register("white-herb", {});             // handled in pvp-room.ts post-stat-change
register("power-herb", {});             // handled in pvp-room.ts two-turn move
register("blunder-policy", {});         // handled in pvp-room.ts accuracy-miss
register("loaded-dice", {});            // handled in pvp-room.ts multi-hit loop
register("room-service", {});           // handled in pvp-room.ts trick-room activation

// ── Weather & Terrain Extenders (consumed by drizzle/drought/... in pvp-abilities) ──
register("heat-rock", {});
register("damp-rock", {});
register("icy-rock", {});
register("smooth-rock", {});
register("terrain-extender", {});

// ── Accuracy & Crit Items ──
register("wide-lens", {});      // handled in pvp-room.ts accuracy check
register("zoom-lens", {});      // handled in pvp-room.ts accuracy check (when moving last)
register("scope-lens", {});     // handled in pvp-room.ts crit rate
register("razor-claw", {});     // handled in pvp-room.ts crit rate

// ── Throat Spray (+1 spAtk after using a sound move) ──
register("throat-spray", {
  afterAttack: (ctx) => {
    const soundMoves = new Set([
      "hyper-voice", "boomburst", "snarl", "echoed-voice", "round",
      "overdrive", "sing", "growl", "roar", "screech", "supersonic",
      "uproar", "chatter", "disarming-voice", "relic-song",
    ]);
    if (soundMoves.has(ctx.move.id) && ctx.atkPoke.heldItem === "throat-spray") {
      ctx.attacker.statStages = applyStatChanges(ctx.attacker.statStages, [{ stat: "spAttack", change: 1 }]);
      ctx.atkPoke.heldItem = null;
      ctx.room.log.push(`${ctx.atkPoke.species}의 목스프레이! 특수공격이 올랐다!`);
    }
  },
});

// ── Eject Button (force user to switch on being hit) ──
register("eject-button", {
  afterBeingHit: (ctx) => {
    if (ctx.damage <= 0 || ctx.defPoke.hp <= 0) return;
    if (ctx.defPoke.heldItem !== "eject-button") return;
    const aliveOthers = ctx.defender.party
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== ctx.defender.activeIndex && p.hp > 0);
    if (aliveOthers.length === 0) return;
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
    ctx.defPoke.heldItem = null;
    ctx.defender.activeIndex = target.i;
    ctx.defender.statStages = { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 };
    ctx.defender.volatiles = [];
    ctx.room.log.push(`${ctx.defPoke.species}의 탈출버튼! 교체했다!`);
  },
});

// ── Red Card (force attacker to switch out on being hit) ──
register("red-card", {
  afterBeingHit: (ctx) => {
    if (ctx.damage <= 0 || ctx.atkPoke.hp <= 0 || ctx.defPoke.hp <= 0) return;
    if (ctx.defPoke.heldItem !== "red-card") return;
    const aliveOthers = ctx.attacker.party
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== ctx.attacker.activeIndex && p.hp > 0);
    if (aliveOthers.length === 0) return;
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
    ctx.defPoke.heldItem = null;
    ctx.attacker.activeIndex = target.i;
    ctx.attacker.statStages = { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 };
    ctx.attacker.volatiles = [];
    ctx.room.log.push(`${ctx.defPoke.species}의 레드카드! ${ctx.atkPoke.species}이(가) 강제 교체됐다!`);
  },
});

// ── Mental Herb (cure volatile mental statuses) ──
register("mental-herb", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.heldItem !== "mental-herb") return;
    const cured = new Set(["infatuation", "taunt", "encore", "disable", "torment", "heal-block"]);
    const before = ctx.defender.volatiles.length;
    ctx.defender.volatiles = ctx.defender.volatiles.filter(v => !cured.has(v.id));
    if (ctx.defender.volatiles.length < before) {
      ctx.defPoke.heldItem = null;
      // Clean up derived lock state
      ctx.defender.disabledMoveId = undefined;
      ctx.defender.encoreMoveId = undefined;
      ctx.room.log.push(`${ctx.defPoke.species}의 멘탈허브! 상태가 치유됐다!`);
    }
  },
});

// ── King's Rock (10% flinch chance on non-status moves) ──
register("kings-rock", {
  afterAttack: (ctx) => {
    if (ctx.move.category === "status") return;
    if (ctx.atkPoke.heldItem !== "kings-rock") return;
    if (ctx.defPoke.hp <= 0) return;
    if (Math.random() < 0.1) {
      // Only add flinch if defender is not already flinched and can receive
      const alreadyFlinch = ctx.defender.volatiles.some(v => v.id === "flinch");
      if (!alreadyFlinch) {
        ctx.defender.volatiles = [...ctx.defender.volatiles, { id: "flinch", turnsRemaining: 1 }];
      }
    }
  },
});

// ── Status Healing Berries ──

register("cheri-berry", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.statusCondition === "paralysis" && ctx.defPoke.heldItem === "cheri-berry") {
      ctx.defPoke.statusCondition = null;
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 크라보열매! 마비가 치유됐다!`);
    }
  },
});

register("chesto-berry", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.statusCondition === "sleep" && ctx.defPoke.heldItem === "chesto-berry") {
      ctx.defPoke.statusCondition = null;
      ctx.defPoke.sleepTurns = undefined;
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 유루열매! 잠듦이 치유됐다!`);
    }
  },
});

register("pecha-berry", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.statusCondition === "poison" && ctx.defPoke.heldItem === "pecha-berry") {
      ctx.defPoke.statusCondition = null;
      ctx.defPoke.toxicCounter = undefined;
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 복숭아열매! 독이 치유됐다!`);
    }
  },
});

register("rawst-berry", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.statusCondition === "burn" && ctx.defPoke.heldItem === "rawst-berry") {
      ctx.defPoke.statusCondition = null;
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 리샘열매! 화상이 치유됐다!`);
    }
  },
});

register("aspear-berry", {
  afterBeingHit: (ctx) => {
    if (ctx.defPoke.statusCondition === "freeze" && ctx.defPoke.heldItem === "aspear-berry") {
      ctx.defPoke.statusCondition = null;
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 나모열매! 얼음이 치유됐다!`);
    }
  },
});

// ── Air Balloon ──

register("air-balloon", {
  onDefense: (ctx) => ctx.move.type === "ground" ? 0 : 1,
  afterBeingHit: (ctx) => {
    if (ctx.damage > 0 && ctx.defPoke.heldItem === "air-balloon") {
      ctx.defPoke.heldItem = null;
      ctx.room.log.push(`${ctx.defPoke.species}의 풍선이 터졌다!`);
    }
  },
});

// ══════════════════════════════════════════════════════════════
// ── Batch 7: New items ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════

register("utility-umbrella", { weatherImmune: true });
register("shed-shell", { bypassTrap: true });
register("lagging-tail", { alwaysLast: true });
register("full-incense", { alwaysLast: true });
register("quick-claw", { quickClaw: true });

// Binding Band: trap damage boost (1/8 -> 1/6) is applied via `trapDamageBoost` flag
// that pvp-room.ts sets when a trap move lands while the attacker holds this item.
register("binding-band", {});
// Grip Claw: fixes trap duration to 7 turns (handled in pvp-room.ts trap application).
register("grip-claw", {});
// Metronome (item): consecutive uses of the same move multiply attack damage
// up to 2x. `metronomeCount` is maintained on PvpPlayerState by pvp-room.ts.
register("metronome", {
  onAttack: (ctx) => {
    const count = ctx.attacker.metronomeCount ?? 0;
    if (count <= 0) return 1;
    const capped = Math.min(5, count);
    return 1 + capped * 0.2;
  },
});
