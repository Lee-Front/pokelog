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
import { addVolatile, hasVolatile } from "../game/status-conditions.js";
import { applyStatChanges } from "../game/battle.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";

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
  isProtect?: boolean;
  isTrapping?: boolean;
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
// Phase 2: populate registry with all moves currently handled by
// hardcoded logic in pvp-room.ts. Runtime logic still lives in
// pvp-room.ts; these entries exist so the registry is complete and
// Phase 3 can swap execution over incrementally.

// ── Flag-only registrations ──

// OHKO
for (const id of ["fissure", "sheer-cold", "horn-drill", "guillotine"]) {
  register(id, { flags: { isOHKO: true } });
}

// Evasion
for (const id of ["double-team", "minimize"]) {
  register(id, { flags: { isEvasion: true } });
}

// Self-KO
for (const id of [
  "self-destruct", "explosion", "memento", "final-gambit",
  "healing-wish", "lunar-dance", "misty-explosion",
]) {
  register(id, { flags: { selfKO: true } });
}

// Semi-invulnerable two-turn
for (const id of ["fly", "dig", "dive", "bounce", "phantom-force", "shadow-force"]) {
  register(id, { flags: { twoTurn: true, semiInvulnerable: true } });
}

// Regular two-turn
for (const id of ["sky-attack", "solar-beam", "meteor-beam", "skull-bash", "razor-wind"]) {
  register(id, { flags: { twoTurn: true } });
}

// Hazard setters
register("stealth-rock", { flags: { setsHazard: "stealth-rock" } });
register("spikes", { flags: { setsHazard: "spikes" } });
register("toxic-spikes", { flags: { setsHazard: "toxic-spikes" } });
register("sticky-web", { flags: { setsHazard: "sticky-web" } });

// Hazard clearers
register("rapid-spin", { flags: { clearsHazards: "own" } });
register("defog", { flags: { clearsHazards: "both" } });

// Terrain setters
register("electric-terrain", { flags: { setsTerrain: "electric" } });
register("grassy-terrain", { flags: { setsTerrain: "grassy" } });
register("psychic-terrain", { flags: { setsTerrain: "psychic" } });
register("misty-terrain", { flags: { setsTerrain: "misty" } });

// Weather setters
register("sunny-day", { flags: { setsWeather: "sun" } });
register("rain-dance", { flags: { setsWeather: "rain" } });
register("sandstorm", { flags: { setsWeather: "sandstorm" } });
register("hail", { flags: { setsWeather: "hail" } });

// Screens
register("reflect", { flags: { setsScreen: "reflect" } });
register("light-screen", { flags: { setsScreen: "light-screen" } });
register("aurora-veil", { flags: { setsScreen: "aurora-veil" } });

// Rooms
register("trick-room", { flags: { setsRoom: "trick-room" } });
register("magic-room", { flags: { setsRoom: "magic-room" } });
register("wonder-room", { flags: { setsRoom: "wonder-room" } });

// Forced switch (user) — parting-shot is defined with onHit below and
// also carries forcesSwitch:"user" there, so we skip it in this loop.
for (const id of ["u-turn", "volt-switch", "flip-turn", "baton-pass"]) {
  register(id, { flags: { forcesSwitch: "user" } });
}

// Forced switch (target, phazing)
for (const id of ["whirlwind", "roar", "dragon-tail", "circle-throw"]) {
  register(id, { flags: { forcesSwitch: "target" } });
}

// Sound moves — extend existing flags if the id was already registered above.
for (const id of [
  "hyper-voice", "boomburst", "snarl", "echoed-voice", "round", "overdrive",
  "sing", "growl", "roar", "chatter",
]) {
  const existing = getMoveEffects(id) ?? {};
  register(id, { ...existing, flags: { ...(existing.flags ?? {}), sound: true } });
}

// Protect family
for (const id of [
  "protect", "detect", "kings-shield", "baneful-bunker",
  "spiky-shield", "obstruct", "silk-trap",
]) {
  register(id, { flags: { isProtect: true } });
}

// Trapping moves
for (const id of [
  "mean-look", "block", "spider-web", "jaw-lock",
  "spirit-shackle", "anchor-shot", "thousand-waves",
]) {
  const existing = getMoveEffects(id) ?? {};
  register(id, { ...existing, flags: { ...(existing.flags ?? {}), isTrapping: true } });
}

// Punch moves (for Iron Fist etc.)
for (const id of [
  "mega-punch", "fire-punch", "ice-punch", "thunder-punch", "mach-punch",
  "focus-punch", "comet-punch", "dizzy-punch", "drain-punch", "dynamic-punch",
  "hammer-arm", "bullet-punch", "shadow-punch", "sky-uppercut", "power-up-punch",
  "plasma-fists", "meteor-mash", "poison-jab",
]) {
  const existing = getMoveEffects(id) ?? {};
  register(id, { ...existing, flags: { ...(existing.flags ?? {}), punch: true } });
}

// Bite moves (for Strong Jaw etc.)
for (const id of [
  "bite", "crunch", "fire-fang", "ice-fang", "thunder-fang", "poison-fang",
  "hyper-fang", "psychic-fangs", "jaw-lock", "fishious-rend",
]) {
  const existing = getMoveEffects(id) ?? {};
  register(id, { ...existing, flags: { ...(existing.flags ?? {}), bite: true } });
}

// Pulse moves (for Mega Launcher etc.)
for (const id of [
  "dark-pulse", "water-pulse", "dragon-pulse", "origin-pulse",
  "aura-sphere", "heal-pulse", "terrain-pulse",
]) {
  const existing = getMoveEffects(id) ?? {};
  register(id, { ...existing, flags: { ...(existing.flags ?? {}), pulse: true } });
}

// ── Fixed damage ──
register("dragon-rage", { fixedDamage: () => 40 });
register("sonic-boom", { fixedDamage: () => 20 });
register("seismic-toss", { fixedDamage: (ctx) => ctx.atkPoke.level });
register("night-shade", { fixedDamage: (ctx) => ctx.atkPoke.level });
register("psywave", { fixedDamage: (ctx) => ctx.atkPoke.level });

// ── Status / volatile applying moves ──

register("taunt", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "taunt", 3);
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 도발 당했다!`);
    }
  },
});

register("disable", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0 && ctx.defender.lastMoveUsed) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "disable", 4);
      ctx.defender.disabledMoveId = ctx.defender.lastMoveUsed;
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: ${ctx.defender.lastMoveUsed}이(가) 사슬묶기 됐다!`);
    }
  },
});

register("encore", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0 && ctx.defender.lastMoveUsed) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "encore", 3);
      ctx.defender.encoreMoveId = ctx.defender.lastMoveUsed;
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 앵콜!`);
    }
  },
});

register("torment", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "torment", -1);
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 트집!`);
    }
  },
});

register("yawn", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0 && !ctx.defPoke.statusCondition) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "yawn", 2);
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 졸음이 몰려온다!`);
    }
  },
});

register("leech-seed", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp <= 0) return;
    if (hasVolatile(ctx.defender.volatiles, "leech-seed")) return;
    const defTypes = getEffectiveTypes(ctx.defPoke.species, ctx.defPoke.variantId, ctx.defender.battleForm);
    if (defTypes.includes("grass")) {
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 씨뿌리기가 통하지 않았다!`);
      return;
    }
    ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "leech-seed", -1);
    ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 씨뿌리기!`);
  },
});

register("heal-block", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "heal-block", 5);
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 회복봉인!`);
    }
  },
});

register("embargo", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "embargo", 5);
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 아이템금지!`);
    }
  },
});

register("perish-song", {
  applyEffect: (ctx) => {
    for (const side of [ctx.attacker, ctx.defender]) {
      if (!hasVolatile(side.volatiles, "perish-song")) {
        side.volatiles = addVolatile(side.volatiles, "perish-song", 4);
      }
    }
    ctx.room.log.push("멸망의노래가 울려퍼졌다!");
  },
});

register("foresight", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "foresight", -1);
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 타입 내성이 사라졌다!`);
    }
  },
});
register("odor-sleuth", {
  applyEffect: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.volatiles = addVolatile(ctx.defender.volatiles, "foresight", -1);
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: 타입 내성이 사라졌다!`);
    }
  },
});

register("ingrain", {
  applyEffect: (ctx) => {
    ctx.attacker.volatiles = addVolatile(ctx.attacker.volatiles, "ingrain", -1);
    ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 뿌리내리기!`);
  },
});

register("focus-energy", {
  applyEffect: (ctx) => {
    if (!hasVolatile(ctx.attacker.volatiles, "focus-energy")) {
      ctx.attacker.volatiles = addVolatile(ctx.attacker.volatiles, "focus-energy", -1);
      ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 기력충전!`);
    }
  },
});

register("destiny-bond", {
  applyEffect: (ctx) => {
    ctx.attacker.volatiles = addVolatile(ctx.attacker.volatiles, "destiny-bond", 2);
    ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 운명의끈!`);
  },
});

register("magic-coat", {
  applyEffect: (ctx) => {
    ctx.attacker.volatiles = addVolatile(ctx.attacker.volatiles, "magic-coat", 1);
    ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 매직코트!`);
  },
});

// ── Healing moves ──

const HALF_HEAL = (ctx: MoveContext) => {
  const heal = Math.floor(ctx.atkPoke.maxHp / 2);
  ctx.atkPoke.hp = Math.min(ctx.atkPoke.maxHp, ctx.atkPoke.hp + heal);
  ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: HP를 회복했다!`);
};

register("recover", { heal: HALF_HEAL });
for (const id of ["soft-boiled", "milk-drink", "slack-off", "shore-up"]) {
  register(id, { heal: HALF_HEAL });
}

register("roost", {
  heal: (ctx) => {
    const heal = Math.floor(ctx.atkPoke.maxHp / 2);
    ctx.atkPoke.hp = Math.min(ctx.atkPoke.maxHp, ctx.atkPoke.hp + heal);
    const types = getEffectiveTypes(ctx.atkPoke.species, ctx.atkPoke.variantId, ctx.attacker.battleForm);
    if (types.includes("flying")) ctx.attacker.roostedThisTurn = true;
    ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: HP를 회복했다!`);
  },
});

register("rest", {
  heal: (ctx) => {
    ctx.atkPoke.hp = ctx.atkPoke.maxHp;
    ctx.atkPoke.statusCondition = "sleep";
    ctx.atkPoke.sleepTurns = 2;
    ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: 잠듦! HP가 완전히 회복됐다!`);
  },
});

for (const id of ["moonlight", "synthesis", "morning-sun"]) {
  register(id, {
    heal: (ctx) => {
      let ratio = 0.5;
      if (ctx.room.weather === "sun") ratio = 2 / 3;
      else if (ctx.room.weather) ratio = 0.25;
      const heal = Math.floor(ctx.atkPoke.maxHp * ratio);
      ctx.atkPoke.hp = Math.min(ctx.atkPoke.maxHp, ctx.atkPoke.hp + heal);
      ctx.room.log.push(`${ctx.attacker.nickname}의 ${ctx.atkPoke.species}: HP를 회복했다!`);
    },
  });
}

// ── onHit / modifyPower moves ──

register("knock-off", {
  modifyPower: (ctx) => (ctx.defPoke.heldItem ? ctx.move.power * 1.5 : ctx.move.power),
  onHit: (ctx) => {
    if (ctx.defPoke.heldItem && ctx.defPoke.hp > 0) {
      ctx.room.log.push(`${ctx.defender.nickname}의 ${ctx.defPoke.species}: ${ctx.defPoke.heldItem}을(를) 떨어뜨렸다!`);
      ctx.defPoke.heldItem = null;
    }
  },
});

const SWAP_HELD_ITEMS = (ctx: MoveContext) => {
  if (ctx.defPoke.hp <= 0) return;
  const tmp = ctx.atkPoke.heldItem;
  ctx.atkPoke.heldItem = ctx.defPoke.heldItem ?? null;
  ctx.defPoke.heldItem = tmp ?? null;
  ctx.room.log.push(`도구가 바뀌었다!`);
};
register("trick", { onHit: SWAP_HELD_ITEMS });
register("switcheroo", { onHit: SWAP_HELD_ITEMS });

const BREAK_SCREENS = (ctx: MoveContext) => {
  if (ctx.defender.screens) {
    ctx.defender.screens = undefined;
    ctx.room.log.push("벽이 부서졌다!");
  }
};
register("brick-break", { onHit: BREAK_SCREENS });
// psychic-fangs was already registered with the bite flag above — extend it.
{
  const existing = getMoveEffects("psychic-fangs") ?? {};
  register("psychic-fangs", { ...existing, onHit: BREAK_SCREENS });
}

register("parting-shot", {
  flags: { forcesSwitch: "user" },
  onHit: (ctx) => {
    if (ctx.defPoke.hp > 0) {
      ctx.defender.statStages = applyStatChanges(ctx.defender.statStages, [
        { stat: "attack", change: -1 },
        { stat: "spAttack", change: -1 },
      ]);
      ctx.room.log.push(`${ctx.defender.nickname}의 공격과 특수공격이 내려갔다!`);
    }
  },
});

// ── Complex custom-resolve moves ──
// These retain their hardcoded logic in pvp-room.ts for now (Phase 3 will
// migrate each individually). Registering them with empty effects merely
// advertises their presence in the registry.
const COMPLEX_CUSTOM = [
  "transform", "copycat", "metronome", "snore", "sleep-talk",
  "pain-split", "endeavor", "counter", "mirror-coat", "belly-drum",
  "substitute", "fake-out", "curse", "attract", "wish", "mimic",
];
for (const id of COMPLEX_CUSTOM) {
  if (!getMoveEffects(id)) register(id, {});
}
