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
