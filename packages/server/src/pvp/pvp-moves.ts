/**
 * PvP Move Effects Framework
 *
 * Provides a registry of move effects and hook functions that pvp-room.ts
 * can invoke at appropriate points during move resolution. This file only
 * establishes the framework — no moves are registered here yet. Later phases
 * will migrate existing move handling from pvp-room.ts into this registry.
 */
import type { MoveData } from "../../../../shared/types.js";
import type { PvpPlayerState, PvpPokemon, PvpRoomState } from "../../../../shared/pvp-types.js";

// ── Context passed to all move effect hooks ──
export interface MoveContext {
  room: PvpRoomState;
  attacker: PvpPlayerState;
  defender: PvpPlayerState;
  atkPoke: PvpPokemon;
  defPoke: PvpPokemon;
  move: MoveData;
  moveId: string;
  damage?: number;
  missed?: boolean;
}

// ── Flag attributes for moves ──
export interface MoveFlags {
  selfKO?: boolean;
  twoTurn?: boolean;
  semiInvulnerable?: boolean;
  forcesSwitch?: "user" | "target";
  setsHazard?: "stealth-rock" | "spikes" | "toxic-spikes" | "sticky-web";
  clearsHazards?: "own" | "opponent" | "both";
  ignoresSubstitute?: boolean;
  ignoresProtect?: boolean;
  ignoresAccuracy?: boolean;
  contact?: boolean;
  powder?: boolean;
  sound?: boolean;
  punch?: boolean;
  bite?: boolean;
  pulse?: boolean;
  isOHKO?: boolean;
  isEvasion?: boolean;
  setsTerrain?: "electric" | "grassy" | "psychic" | "misty";
  setsWeather?: "sun" | "rain" | "sandstorm" | "hail";
  setsScreen?: "reflect" | "light-screen" | "aurora-veil";
  setsRoom?: "trick-room" | "magic-room" | "wonder-room";
}

// ── Effect hooks ──
export interface MoveEffects {
  /** Completely custom handler. Returns true to skip all default processing. */
  customResolve?: (ctx: MoveContext) => boolean;

  /** Runs before execution. Return { cancel, message } to abort. */
  beforeMove?: (ctx: MoveContext) => { cancel?: boolean; message?: string } | void;

  /** Override move power. Returns new power value. */
  modifyPower?: (ctx: MoveContext) => number;

  /** Override damage entirely. Return damage amount or null for normal calc. */
  fixedDamage?: (ctx: MoveContext) => number | null;

  /** Runs after damage applied (hit case). */
  onHit?: (ctx: MoveContext) => void;

  /** Runs when move misses. */
  onMiss?: (ctx: MoveContext) => void;

  /** Apply field/status effects. */
  applyEffect?: (ctx: MoveContext) => void;

  /** Healing moves. */
  heal?: (ctx: MoveContext) => void;

  /** Move flags. */
  flags?: MoveFlags;
}

// ── Registry ──
const moveRegistry = new Map<string, MoveEffects>();

/** Register move effects for a given move ID. */
export function register(moveId: string, effects: MoveEffects): void {
  moveRegistry.set(moveId, effects);
}

/** Get registered effects for a move (or undefined if not registered). */
export function getMoveEffects(moveId: string): MoveEffects | undefined {
  return moveRegistry.get(moveId);
}

// ── Flag query helpers (for pvp-room.ts integration) ──

/** Return true if the move has the given flag set to a truthy value. */
export function hasFlag(moveId: string, flag: keyof MoveFlags): boolean {
  const effects = getMoveEffects(moveId);
  return Boolean(effects?.flags?.[flag]);
}

/** Return the raw flag value (useful for string-valued flags). */
export function getFlag<K extends keyof MoveFlags>(moveId: string, flag: K): MoveFlags[K] | undefined {
  return getMoveEffects(moveId)?.flags?.[flag];
}

// Convenience getters
export function isContact(moveId: string): boolean { return hasFlag(moveId, "contact"); }
export function isSound(moveId: string): boolean { return hasFlag(moveId, "sound"); }
export function isPowder(moveId: string): boolean { return hasFlag(moveId, "powder"); }
export function isPunch(moveId: string): boolean { return hasFlag(moveId, "punch"); }
export function isBite(moveId: string): boolean { return hasFlag(moveId, "bite"); }
export function isPulse(moveId: string): boolean { return hasFlag(moveId, "pulse"); }
export function isOHKO(moveId: string): boolean { return hasFlag(moveId, "isOHKO"); }
export function isSelfKO(moveId: string): boolean { return hasFlag(moveId, "selfKO"); }

// ── Executor helpers ──
// These are called from pvp-room.ts in specific places.

/** Run customResolve. Returns true if move was fully handled. */
export function tryCustomResolve(ctx: MoveContext): boolean {
  const effects = getMoveEffects(ctx.moveId);
  return effects?.customResolve?.(ctx) ?? false;
}

/** Run beforeMove check. Returns { cancel, message } or undefined. */
export function tryBeforeMove(ctx: MoveContext): { cancel?: boolean; message?: string } | undefined {
  const effects = getMoveEffects(ctx.moveId);
  const result = effects?.beforeMove?.(ctx);
  return result ?? undefined;
}

/** Apply modifyPower hook. Returns modified power or original. */
export function applyPowerMod(ctx: MoveContext): number {
  const effects = getMoveEffects(ctx.moveId);
  return effects?.modifyPower?.(ctx) ?? ctx.move.power;
}

/** Try fixed damage. Returns damage or null. */
export function tryFixedDamage(ctx: MoveContext): number | null {
  const effects = getMoveEffects(ctx.moveId);
  return effects?.fixedDamage?.(ctx) ?? null;
}

/** Run onHit hook. */
export function triggerOnHit(ctx: MoveContext): void {
  const effects = getMoveEffects(ctx.moveId);
  effects?.onHit?.(ctx);
}

/** Run onMiss hook. */
export function triggerOnMiss(ctx: MoveContext): void {
  const effects = getMoveEffects(ctx.moveId);
  effects?.onMiss?.(ctx);
}

/** Run applyEffect hook. */
export function triggerApplyEffect(ctx: MoveContext): void {
  const effects = getMoveEffects(ctx.moveId);
  effects?.applyEffect?.(ctx);
}

/** Run heal hook. */
export function triggerHeal(ctx: MoveContext): void {
  const effects = getMoveEffects(ctx.moveId);
  effects?.heal?.(ctx);
}

// ══════════════════════════════════════════════════════════════
// ── Move Registrations ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════
// (Framework only — no moves registered in this phase.)
