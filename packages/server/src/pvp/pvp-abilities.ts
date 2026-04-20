/**
 * PvP Ability Effects Framework
 *
 * Provides a registry of ability effects and hook functions that pvp-room.ts
 * calls at the appropriate points during battle resolution.
 */
import type {
  PvpRoomState, PvpPlayerState, PvpPokemon,
} from "../../../../shared/pvp-types.js";
import type { MoveData, BattleWeather } from "../../../../shared/types.js";
import { applyStatChanges } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";
import { getTypeChart } from "../game/data-loader.js";

// ── Hook Context Types ──

export interface OnSwitchInContext {
  room: PvpRoomState;
  player: PvpPlayerState;
  opponent: PvpPlayerState;
  pokemon: PvpPokemon;
}

export interface DamageModContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;
  damage: number;
}

export interface OnMoveUseContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  atkPoke: PvpPokemon;
  move: MoveData;
}

export interface StatusGuardContext {
  pokemon: PvpPokemon;
  status: string;
}

export interface EndOfTurnContext {
  room: PvpRoomState;
  player: PvpPlayerState;
  opponent: PvpPlayerState;
  pokemon: PvpPokemon;
}

export interface OnSwitchOutContext {
  player: PvpPlayerState;
  pokemon: PvpPokemon;
}

// ── Ability Effects Interface ──

export interface AbilityEffects {
  /** Triggered when the pokemon switches in (or is sent out as lead). */
  onSwitchIn?: (ctx: OnSwitchInContext) => void;

  /** Triggered when the pokemon switches out. */
  onSwitchOut?: (ctx: OnSwitchOutContext) => void;

  /**
   * Attack multiplier applied to damage when this pokemon attacks.
   * Return a multiplier (e.g. 1.3 for technician on weak moves).
   * Default: 1.
   */
  onAttack?: (ctx: DamageModContext) => number;

  /**
   * Defense multiplier applied to damage when this pokemon defends.
   * Return a multiplier (e.g. 0.5 for thick-fat vs fire/ice).
   * Return -1 for sturdy-like effects (survive at 1 HP).
   * Default: 1.
   */
  onDefense?: (ctx: DamageModContext) => number;

  /**
   * Check whether this pokemon can receive a given status condition.
   * Return true if the status CAN be applied, false to block it.
   * Default: true.
   */
  canReceiveStatus?: (ctx: StatusGuardContext) => boolean;

  /** Triggered at end of turn for this pokemon. */
  onEndOfTurn?: (ctx: EndOfTurnContext) => void;

  /**
   * Speed modifier. Returns modified speed value.
   * Called with the pokemon's base speed (before paralysis).
   */
  onSpeed?: (speed: number, pokemon: PvpPokemon, weather?: BattleWeather) => number;

  /**
   * Priority modifier for moves. Returns a priority adjustment (e.g. +1 for prankster on status moves).
   */
  onPriority?: (ctx: OnMoveUseContext) => number;

  /** Boolean flags for special ability behaviors. */
  flags?: {
    /** This ability ignores the opponent's ability (e.g. mold-breaker, turboblaze, teravolt). */
    ignoresOpponentAbility?: boolean;
  };
}

// ── Registry ──

const registry = new Map<string, AbilityEffects>();

/** Register ability effects for a given ability ID. */
export function register(abilityId: string, effects: AbilityEffects): void {
  registry.set(abilityId, effects);
}

/** Get registered effects for an ability (or undefined if not registered). */
export function getEffects(abilityId: string): AbilityEffects | undefined {
  return registry.get(abilityId);
}

// ── Public API Functions ──

/** Trigger onSwitchIn for the active pokemon's ability. */
export function triggerOnSwitchIn(ctx: OnSwitchInContext): void {
  const abilityId = ctx.pokemon.abilityId;
  if (!abilityId) return;
  const effects = registry.get(abilityId);
  effects?.onSwitchIn?.(ctx);
}

/** Trigger onSwitchOut for the pokemon's ability. */
export function triggerOnSwitchOut(ctx: OnSwitchOutContext): void {
  const abilityId = ctx.pokemon.abilityId;
  if (!abilityId) return;
  const effects = registry.get(abilityId);
  effects?.onSwitchOut?.(ctx);
}

/**
 * Get the attack multiplier from the attacker's ability.
 * Returns 1 if no ability or no onAttack hook registered.
 */
export function getAttackMultiplier(ctx: DamageModContext): number {
  const abilityId = ctx.atkPoke.abilityId;
  if (!abilityId) return 1;
  const effects = registry.get(abilityId);
  if (!effects?.onAttack) return 1;
  return effects.onAttack(ctx);
}

/**
 * Get the defense multiplier from the defender's ability.
 * Returns 1 if no ability or no onDefense hook registered.
 * Returns -1 for sturdy-like effects (caller should set HP to 1 instead).
 *
 * If the attacker has an ability with ignoresOpponentAbility flag, the
 * defender's ability is bypassed (returns 1).
 */
export function getDefenseMultiplier(ctx: DamageModContext): number {
  const defAbilityId = ctx.defPoke.abilityId;
  if (!defAbilityId) return 1;

  // Mold-breaker check: if attacker's ability ignores opponent abilities, skip defender ability
  const atkAbilityId = ctx.atkPoke.abilityId;
  if (atkAbilityId) {
    const atkEffects = registry.get(atkAbilityId);
    if (atkEffects?.flags?.ignoresOpponentAbility) return 1;
  }

  const defEffects = registry.get(defAbilityId);
  if (!defEffects?.onDefense) return 1;
  return defEffects.onDefense(ctx);
}

/**
 * Get move modifiers from the attacker's ability.
 * Returns { powerMod, priorityMod } — both default to 0 (no change).
 * powerMod is applied as a multiplier to move power.
 * priorityMod is added to move priority.
 */
export function getMoveModifiers(ctx: OnMoveUseContext): { powerMod: number; priorityMod: number } {
  const abilityId = ctx.atkPoke.abilityId;
  const result = { powerMod: 1, priorityMod: 0 };
  if (!abilityId) return result;
  const effects = registry.get(abilityId);
  if (effects?.onPriority) {
    result.priorityMod = effects.onPriority(ctx);
  }
  return result;
}

/**
 * Check whether a pokemon can receive a given status condition.
 * Returns true if the status CAN be applied, false to block it.
 *
 * If the attacker has mold-breaker-style ability, caller should skip this check.
 */
export function canReceiveStatus(pokemon: PvpPokemon, status: string): boolean {
  const abilityId = pokemon.abilityId;
  if (!abilityId) return true;
  const effects = registry.get(abilityId);
  if (!effects?.canReceiveStatus) return true;
  return effects.canReceiveStatus({ pokemon, status });
}

/** Trigger end-of-turn effects for the pokemon's ability. */
export function triggerEndOfTurn(ctx: EndOfTurnContext): void {
  const abilityId = ctx.pokemon.abilityId;
  if (!abilityId) return;
  const effects = registry.get(abilityId);
  effects?.onEndOfTurn?.(ctx);
}

/**
 * Get effective speed, modified by the pokemon's ability.
 * This should be called BEFORE applying paralysis reduction.
 */
export function getEffectiveSpeed(speed: number, pokemon: PvpPokemon, weather?: BattleWeather): number {
  const abilityId = pokemon.abilityId;
  if (!abilityId) return speed;
  const effects = registry.get(abilityId);
  if (!effects?.onSpeed) return speed;
  return effects.onSpeed(speed, pokemon, weather);
}

/**
 * Check if an ability has a specific boolean flag.
 * For example, hasAbilityFlag("mold-breaker", "ignoresOpponentAbility") => true.
 */
export function hasAbilityFlag(abilityId: string, flag: keyof NonNullable<AbilityEffects["flags"]>): boolean {
  const effects = registry.get(abilityId);
  if (!effects?.flags) return false;
  return effects.flags[flag] ?? false;
}

// ══════════════════════════════════════════════════════════════
// ── Ability Registrations ────────────────────────────────────
// ══════════════════════════════════════════════════════════════

// ── Task 3: Switch-In Abilities ──

register("intimidate", {
  onSwitchIn: (ctx) => {
    ctx.opponent.statStages = applyStatChanges(ctx.opponent.statStages, [{ stat: "attack", change: -1 }]);
    ctx.room.log.push(`${ctx.pokemon.species}의 위협! 상대의 공격이 내려갔다!`);
  },
});

register("drizzle", {
  onSwitchIn: (ctx) => {
    ctx.room.weather = "rain";
    ctx.room.weatherTurns = ctx.pokemon.heldItem === "damp-rock" ? 8 : 5;
    ctx.room.log.push("비가 내리기 시작했다!");
  },
});
register("drought", {
  onSwitchIn: (ctx) => {
    ctx.room.weather = "sun";
    ctx.room.weatherTurns = ctx.pokemon.heldItem === "heat-rock" ? 8 : 5;
    ctx.room.log.push("햇살이 강해졌다!");
  },
});
register("sand-stream", {
  onSwitchIn: (ctx) => {
    ctx.room.weather = "sandstorm";
    ctx.room.weatherTurns = ctx.pokemon.heldItem === "smooth-rock" ? 8 : 5;
    ctx.room.log.push("모래바람이 불기 시작했다!");
  },
});
register("snow-warning", {
  onSwitchIn: (ctx) => {
    ctx.room.weather = "hail";
    ctx.room.weatherTurns = ctx.pokemon.heldItem === "icy-rock" ? 8 : 5;
    ctx.room.log.push("우박이 내리기 시작했다!");
  },
});

// ── Task 4: Offensive Abilities ──

register("adaptability", {
  onAttack: (ctx) => {
    const types = getEffectiveTypes(ctx.atkPoke.species, ctx.atkPoke.variantId, ctx.attacker.battleForm);
    return types.includes(ctx.move.type) ? (2 / 1.5) : 1;
  },
});

register("technician", {
  onAttack: (ctx) => (ctx.move.power > 0 && ctx.move.power <= 60) ? 1.5 : 1,
});

register("huge-power", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 2 : 1,
});
register("pure-power", {
  onAttack: (ctx) => ctx.move.category === "physical" ? 2 : 1,
});

register("guts", {
  onAttack: (ctx) => ctx.atkPoke.statusCondition ? 1.5 : 1,
});

register("overgrow", {
  onAttack: (ctx) => (ctx.atkPoke.hp <= ctx.atkPoke.maxHp / 3 && ctx.move.type === "grass") ? 1.5 : 1,
});
register("blaze", {
  onAttack: (ctx) => (ctx.atkPoke.hp <= ctx.atkPoke.maxHp / 3 && ctx.move.type === "fire") ? 1.5 : 1,
});
register("torrent", {
  onAttack: (ctx) => (ctx.atkPoke.hp <= ctx.atkPoke.maxHp / 3 && ctx.move.type === "water") ? 1.5 : 1,
});
register("swarm", {
  onAttack: (ctx) => (ctx.atkPoke.hp <= ctx.atkPoke.maxHp / 3 && ctx.move.type === "bug") ? 1.5 : 1,
});

register("iron-fist", {
  onAttack: (ctx) => {
    const punchMoves = new Set(["mega-punch", "fire-punch", "ice-punch", "thunder-punch", "mach-punch", "focus-punch", "comet-punch", "dizzy-punch", "drain-punch", "dynamic-punch", "hammer-arm", "bullet-punch", "shadow-punch", "sky-uppercut", "power-up-punch", "plasma-fists", "meteor-mash", "poison-jab"]);
    return punchMoves.has(ctx.move.id) ? 1.2 : 1;
  },
});

register("strong-jaw", {
  onAttack: (ctx) => {
    const biteMoves = new Set(["bite", "crunch", "fire-fang", "ice-fang", "thunder-fang", "poison-fang", "hyper-fang", "psychic-fangs", "jaw-lock", "fishious-rend"]);
    return biteMoves.has(ctx.move.id) ? 1.5 : 1;
  },
});

register("reckless", {
  onAttack: (ctx) => (ctx.move.meta?.drain != null && ctx.move.meta.drain < 0) ? 1.2 : 1,
});

register("sheer-force", {
  onAttack: (ctx) => {
    const hasSideEffect = (ctx.move.meta?.ailmentChance ?? 0) > 0 || (ctx.move.meta?.flinchChance ?? 0) > 0 || (ctx.move.meta?.statChance ?? 0) > 0;
    return hasSideEffect ? 1.3 : 1;
  },
});

// ── Task 5: Defensive/Immunity Abilities ──

register("levitate", {
  onDefense: (ctx) => ctx.move.type === "ground" ? 0 : 1,
});

register("flash-fire", {
  onDefense: (ctx) => ctx.move.type === "fire" ? 0 : 1,
});

register("volt-absorb", {
  onDefense: (ctx) => {
    if (ctx.move.type === "electric") {
      const heal = Math.max(1, Math.floor(ctx.defPoke.maxHp / 4));
      ctx.defPoke.hp = Math.min(ctx.defPoke.maxHp, ctx.defPoke.hp + heal);
      ctx.room.log.push(`${ctx.defPoke.species}의 축전! HP를 회복했다!`);
      return 0;
    }
    return 1;
  },
});

register("water-absorb", {
  onDefense: (ctx) => {
    if (ctx.move.type === "water") {
      const heal = Math.max(1, Math.floor(ctx.defPoke.maxHp / 4));
      ctx.defPoke.hp = Math.min(ctx.defPoke.maxHp, ctx.defPoke.hp + heal);
      ctx.room.log.push(`${ctx.defPoke.species}의 저수! HP를 회복했다!`);
      return 0;
    }
    return 1;
  },
});

register("lightning-rod", {
  onDefense: (ctx) => {
    if (ctx.move.type === "electric") {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "spAttack", change: 1 }]);
      ctx.room.log.push(`${ctx.defPoke.species}의 피뢰침! 특수공격이 올랐다!`);
      return 0;
    }
    return 1;
  },
});

register("storm-drain", {
  onDefense: (ctx) => {
    if (ctx.move.type === "water") {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "spAttack", change: 1 }]);
      ctx.room.log.push(`${ctx.defPoke.species}의 폭풍배수구! 특수공격이 올랐다!`);
      return 0;
    }
    return 1;
  },
});

register("sap-sipper", {
  onDefense: (ctx) => {
    if (ctx.move.type === "grass") {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "attack", change: 1 }]);
      ctx.room.log.push(`${ctx.defPoke.species}의 초식! 공격이 올랐다!`);
      return 0;
    }
    return 1;
  },
});

register("motor-drive", {
  onDefense: (ctx) => {
    if (ctx.move.type === "electric") {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [{ stat: "speed", change: 1 }]);
      ctx.room.log.push(`${ctx.defPoke.species}의 전기엔진! 스피드가 올랐다!`);
      return 0;
    }
    return 1;
  },
});

register("dry-skin", {
  onDefense: (ctx) => {
    if (ctx.move.type === "water") {
      const heal = Math.max(1, Math.floor(ctx.defPoke.maxHp / 4));
      ctx.defPoke.hp = Math.min(ctx.defPoke.maxHp, ctx.defPoke.hp + heal);
      ctx.room.log.push(`${ctx.defPoke.species}의 건조피부! HP를 회복했다!`);
      return 0;
    }
    if (ctx.move.type === "fire") return 1.25;
    return 1;
  },
});

register("thick-fat", {
  onDefense: (ctx) => (ctx.move.type === "fire" || ctx.move.type === "ice") ? 0.5 : 1,
});

register("multiscale", {
  onDefense: (ctx) => ctx.defPoke.hp >= ctx.defPoke.maxHp ? 0.5 : 1,
});

register("sturdy", {
  onDefense: (ctx) => {
    if (ctx.defPoke.hp >= ctx.defPoke.maxHp && ctx.damage >= ctx.defPoke.hp) {
      ctx.room.log.push(`${ctx.defPoke.species}의 옹골참! 버텨냈다!`);
      return -1;
    }
    return 1;
  },
});

register("filter", {
  onDefense: (ctx) => {
    const typeChart = getTypeChart();
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    let mult = 1;
    for (const t of defTypes) { mult *= (typeChart[ctx.move.type]?.[t] ?? 1); }
    return mult > 1 ? 0.75 : 1;
  },
});
register("solid-rock", {
  onDefense: (ctx) => {
    const typeChart = getTypeChart();
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    let mult = 1;
    for (const t of defTypes) { mult *= (typeChart[ctx.move.type]?.[t] ?? 1); }
    return mult > 1 ? 0.75 : 1;
  },
});

register("fur-coat", {
  onDefense: (ctx) => ctx.move.category === "physical" ? 0.5 : 1,
});

register("ice-scales", {
  onDefense: (ctx) => ctx.move.category === "special" ? 0.5 : 1,
});

// ── Task 6: Status Immunity Abilities ──

register("immunity", { canReceiveStatus: (ctx) => ctx.status !== "poison" });
register("limber", { canReceiveStatus: (ctx) => ctx.status !== "paralysis" });
register("water-veil", { canReceiveStatus: (ctx) => ctx.status !== "burn" });
register("insomnia", { canReceiveStatus: (ctx) => ctx.status !== "sleep" });
register("vital-spirit", { canReceiveStatus: (ctx) => ctx.status !== "sleep" });
register("magma-armor", { canReceiveStatus: (ctx) => ctx.status !== "freeze" });
register("own-tempo", { canReceiveStatus: (ctx) => ctx.status !== "confusion" });
register("inner-focus", { canReceiveStatus: (ctx) => ctx.status !== "flinch" });
register("oblivious", { canReceiveStatus: (ctx) => ctx.status !== "infatuation" });
register("clear-body", { canReceiveStatus: (ctx) => ctx.status !== "stat-drop" });
register("white-smoke", { canReceiveStatus: (ctx) => ctx.status !== "stat-drop" });

// ── Task 7: Speed/EndOfTurn/SwitchOut Abilities ──

// Speed modifiers
register("swift-swim", { onSpeed: (speed, _poke, weather) => weather === "rain" ? speed * 2 : speed });
register("chlorophyll", { onSpeed: (speed, _poke, weather) => weather === "sun" ? speed * 2 : speed });
register("sand-rush", { onSpeed: (speed, _poke, weather) => weather === "sandstorm" ? speed * 2 : speed });
register("slush-rush", { onSpeed: (speed, _poke, weather) => weather === "hail" ? speed * 2 : speed });

// Priority
register("prankster", { onPriority: (ctx) => ctx.move.category === "status" ? 1 : 0 });
register("gale-wings", { onPriority: (ctx) => (ctx.move.type === "flying" && ctx.atkPoke.hp >= ctx.atkPoke.maxHp) ? 1 : 0 });
register("triage", { onPriority: (ctx) => (ctx.move.meta?.healing ?? 0) > 0 || (ctx.move.meta?.drain ?? 0) > 0 ? 3 : 0 });

// End of turn
register("speed-boost", {
  onEndOfTurn: (ctx) => {
    ctx.player.statStages = applyStatChanges(ctx.player.statStages, [{ stat: "speed", change: 1 }]);
    ctx.room.log.push(`${ctx.pokemon.species}의 가속! 스피드가 올랐다!`);
  },
});

register("poison-heal", {
  onEndOfTurn: (ctx) => {
    if (ctx.pokemon.statusCondition === "poison") {
      const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 8));
      ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
      ctx.room.log.push(`${ctx.pokemon.species}의 포이즌힐! HP를 회복했다!`);
    }
  },
});

register("rain-dish", {
  onEndOfTurn: (ctx) => {
    if (ctx.room.weather === "rain") {
      const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 16));
      ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
      ctx.room.log.push(`${ctx.pokemon.species}의 레인디쉬! HP를 회복했다!`);
    }
  },
});

register("ice-body", {
  onEndOfTurn: (ctx) => {
    if (ctx.room.weather === "hail") {
      const heal = Math.max(1, Math.floor(ctx.pokemon.maxHp / 16));
      ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
      ctx.room.log.push(`${ctx.pokemon.species}의 아이스바디! HP를 회복했다!`);
    }
  },
});

// Switch-out
register("natural-cure", {
  onSwitchOut: (ctx) => {
    if (ctx.pokemon.statusCondition) {
      ctx.pokemon.statusCondition = null;
      ctx.pokemon.sleepTurns = undefined;
      ctx.pokemon.toxicCounter = undefined;
    }
  },
});

register("regenerator", {
  onSwitchOut: (ctx) => {
    const heal = Math.floor(ctx.pokemon.maxHp / 3);
    ctx.pokemon.hp = Math.min(ctx.pokemon.maxHp, ctx.pokemon.hp + heal);
  },
});

// Magic Guard: skip all indirect damage (handled directly in pvp-room.ts)
register("magic-guard", {});

// ── Task 8: Mold Breaker, Unaware, Contrary, Pressure ──

register("mold-breaker", { flags: { ignoresOpponentAbility: true } });
register("turboblaze", { flags: { ignoresOpponentAbility: true } });
register("teravolt", { flags: { ignoresOpponentAbility: true } });

// Unaware: handled directly in pvp-room.ts calculateDamage call
register("unaware", {});

// Contrary: handled directly in pvp-room.ts stat change application
register("contrary", {});

register("pressure", {
  onSwitchIn: (ctx) => {
    ctx.room.log.push(`${ctx.pokemon.species}의 프레셔!`);
  },
});

// ── Contact Abilities (logic in pvp-room.ts, registered here for completeness) ──
register("static", {});
register("poison-point", {});
register("flame-body", {});
register("rough-skin", {});
register("iron-barbs", {});

// ── Batch 3: KO-Triggered Stat Boost ──
// These are flagged here and handled in pvp-room.ts when defender faints from our attack.
register("moxie", {});
register("beast-boost", {});
register("soul-heart", {});

// ── Batch 3: Stat Boost on Being Hit ──
// Handled in pvp-room.ts after damage application.
register("justified", {});
register("rattled", {});
register("stamina", {});
register("water-compaction", {});

// ── Batch 3: Type-specific Damage Boosts ──
register("water-bubble", {
  onAttack: (ctx) => ctx.move.type === "water" ? 2 : 1,
  onDefense: (ctx) => ctx.move.type === "fire" ? 0.5 : 1,
});
register("steelworker", {
  onAttack: (ctx) => ctx.move.type === "steel" ? 1.5 : 1,
});
register("dragons-maw", {
  onAttack: (ctx) => ctx.move.type === "dragon" ? 1.5 : 1,
});
register("transistor", {
  onAttack: (ctx) => ctx.move.type === "electric" ? 1.5 : 1,
});

// ── Batch 3: Type Conversion (-ate abilities) ──
// The actual type override + 1.2x power boost is handled in pvp-room.ts before calculateDamage.
register("pixilate", {});
register("refrigerate", {});
register("aerilate", {});
register("galvanize", {});
register("normalize", {});

// ── Batch 3: Protean / Libero (simplified as always-STAB 1.5x) ──
register("protean", {
  onAttack: () => 1.5,
});
register("libero", {
  onAttack: () => 1.5,
});

// ── Batch 3: Accuracy / Crit / Secondary Effect Modifiers ──
register("serene-grace", {});   // handled in pvp-room.ts (double chances)
register("compound-eyes", {});  // handled in pvp-room.ts (accuracy * 1.3)
register("super-luck", {});     // handled in pvp-room.ts (crit +1)
register("sniper", {});         // handled in pvp-room.ts (crit dmg multiplier)
register("no-guard", {});       // handled in pvp-room.ts (accuracy bypass)
register("skill-link", {});     // handled in pvp-room.ts (multi-hit always max)
register("scrappy", {});        // handled in pvp-room.ts (ignore ghost immunity)

register("tinted-lens", {
  onAttack: (ctx) => {
    const typeChart = getTypeChart();
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    let mult = 1;
    for (const t of defTypes) mult *= (typeChart[ctx.move.type]?.[t] ?? 1);
    return mult > 0 && mult < 1 ? 2 : 1;
  },
});

// ── Batch 3: Conditional Damage Abilities ──
register("sand-force", {
  onAttack: (ctx) => {
    if (ctx.room.weather === "sandstorm" && ["rock", "ground", "steel"].includes(ctx.move.type)) return 1.3;
    return 1;
  },
});

register("toxic-boost", {
  onAttack: (ctx) => (ctx.atkPoke.statusCondition === "poison" && ctx.move.category === "physical") ? 1.5 : 1,
});

register("flare-boost", {
  onAttack: (ctx) => (ctx.atkPoke.statusCondition === "burn" && ctx.move.category === "special") ? 1.5 : 1,
});

register("marvel-scale", {
  onDefense: (ctx) => (ctx.defPoke.statusCondition && ctx.move.category === "physical") ? 0.67 : 1,
});

register("defeatist", {
  onAttack: (ctx) => ctx.atkPoke.hp <= ctx.atkPoke.maxHp / 2 ? 0.5 : 1,
});

// Slow-start / truant need turn tracking (registered as no-ops for now)
register("slow-start", {});
register("truant", {});

register("mega-launcher", {
  onAttack: (ctx) => {
    const pulseMoves = new Set([
      "dark-pulse", "water-pulse", "dragon-pulse", "origin-pulse",
      "aura-sphere", "heal-pulse", "terrain-pulse",
    ]);
    return pulseMoves.has(ctx.move.id) ? 1.5 : 1;
  },
});

// ── Batch 3: Download (switch-in; boosts the better offensive stat vs. opp defenses) ──
register("download", {
  onSwitchIn: (ctx) => {
    const oppPoke = ctx.opponent.party[ctx.opponent.activeIndex];
    if (oppPoke.hp <= 0) return;
    const stat: "attack" | "spAttack" = oppPoke.stats.defense < oppPoke.stats.spDefense ? "attack" : "spAttack";
    ctx.player.statStages = applyStatChanges(ctx.player.statStages, [{ stat, change: 1 }]);
    const label = stat === "attack" ? "공격" : "특수공격";
    ctx.room.log.push(`${ctx.pokemon.species}의 다운로드! ${label}이 올랐다!`);
  },
});

// ── Batch 3: Terrain Surges ──
register("electric-surge", {
  onSwitchIn: (ctx) => {
    ctx.room.terrain = "electric";
    ctx.room.terrainTurns = ctx.pokemon.heldItem === "terrain-extender" ? 8 : 5;
    ctx.room.log.push("일렉트릭필드가 펼쳐졌다!");
  },
});
register("grassy-surge", {
  onSwitchIn: (ctx) => {
    ctx.room.terrain = "grassy";
    ctx.room.terrainTurns = ctx.pokemon.heldItem === "terrain-extender" ? 8 : 5;
    ctx.room.log.push("그래스필드가 펼쳐졌다!");
  },
});
register("psychic-surge", {
  onSwitchIn: (ctx) => {
    ctx.room.terrain = "psychic";
    ctx.room.terrainTurns = ctx.pokemon.heldItem === "terrain-extender" ? 8 : 5;
    ctx.room.log.push("사이코필드가 펼쳐졌다!");
  },
});
register("misty-surge", {
  onSwitchIn: (ctx) => {
    ctx.room.terrain = "misty";
    ctx.room.terrainTurns = ctx.pokemon.heldItem === "terrain-extender" ? 8 : 5;
    ctx.room.log.push("미스트필드가 펼쳐졌다!");
  },
});

// ── Batch 3: Synchronize ──
// Handled in pvp-room.ts when the defender receives a status.
register("synchronize", {});

// ── Trapping Abilities ──
register("shadow-tag", {
  onSwitchIn: (ctx) => {
    const oppPoke = ctx.opponent.party[ctx.opponent.activeIndex];
    // Shadow Tag does not trap other shadow-tag pokemon
    if (oppPoke.abilityId !== "shadow-tag") {
      ctx.opponent.trapped = true;
    }
  },
});

register("arena-trap", {
  onSwitchIn: (ctx) => {
    const oppPoke = ctx.opponent.party[ctx.opponent.activeIndex];
    const types = getEffectiveTypes(oppPoke.species, oppPoke.variantId, ctx.opponent.battleForm);
    // Flying types / levitate are unaffected
    if (!types.includes("flying") && oppPoke.abilityId !== "levitate") {
      ctx.opponent.trapped = true;
    }
  },
});

register("magnet-pull", {
  onSwitchIn: (ctx) => {
    const oppPoke = ctx.opponent.party[ctx.opponent.activeIndex];
    const types = getEffectiveTypes(oppPoke.species, oppPoke.variantId, ctx.opponent.battleForm);
    if (types.includes("steel")) {
      ctx.opponent.trapped = true;
    }
  },
});

// ── Batch 5: Suction Cups (prevents phazing; handled in pvp-room.ts) ──
register("suction-cups", {});

// ── Batch 6: Magic Bounce (reflects status moves; handled in pvp-room.ts) ──
register("magic-bounce", {});
