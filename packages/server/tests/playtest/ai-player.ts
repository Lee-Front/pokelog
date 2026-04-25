/**
 * Heuristic AI players for playtest scenarios.
 *
 * Two layers:
 *   - decideBattleAction: per-turn battle decision (attack / heal / switch)
 *   - decideMetaAction: between-battle decision (encounter / heal / shop)
 *
 * Both are deliberately simple and deterministic enough that scenario
 * authors can predict outcomes; tests that need stochastic mocks should
 * stub Math.random themselves.
 *
 * The PvP-room flow uses chooseAiAction (../../src/pvp/pvp-ai.ts) and is
 * NOT replaced here — these helpers are for the wild-encounter / overworld
 * playtest scenarios that drive the HTTP API.
 */
import type { OwnedPokemon, PokemonMove } from "../../../../shared/types.js";

// ── Shared types ──────────────────────────────────────────────────────────

export interface AiState {
  party: OwnedPokemon[];
  inventory: Record<string, number>;
  points: number;
  pokedexCount: number;
  /** Active pokemon hp (if a battle is ongoing). */
  hp?: { current: number; max: number };
}

export type ActionType = "attack" | "switch" | "item" | "flee" | "capture";

export interface ActionDecision<TDetail = unknown> {
  type: ActionType;
  detail?: TDetail;
}

// ── Battle layer ──────────────────────────────────────────────────────────

export interface BattleAiContext {
  myActivePoke: OwnedPokemon;
  myParty: OwnedPokemon[];
  oppActivePoke: {
    species: string;
    hp: number;
    maxHp: number;
    types?: string[];
  } | null;
  myItems: Record<string, number>;
  /** 1-indexed turn counter (matches PvP rooms). */
  turn: number;
}

export interface BattleDecision {
  /** "attack" → moveId in detail; "switch" → pokemonUid; "item" → itemId; "flee"/"capture" → empty. */
  type: ActionType;
  moveId?: string;
  pokemonUid?: string;
  itemId?: string;
}

const HEALING_ITEMS = ["potion", "super-potion", "hyper-potion", "max-potion", "full-restore"];

function pickHealingItem(inventory: Record<string, number>): string | null {
  for (const id of HEALING_ITEMS) {
    if ((inventory[id] ?? 0) > 0) return id;
  }
  return null;
}

function highestPowerUsable(moves: PokemonMove[]): PokemonMove | null {
  const usable = moves.filter((m) => m.pp > 0);
  if (usable.length === 0) return null;
  // Without move power data on PokemonMove we just keep insertion order;
  // scenario authors who need power-based selection should use the
  // PvP chooseAiAction or pass through getMoveById themselves.
  return usable[0];
}

/**
 * Crisis-aware battle decision: heal at low HP if items available, then
 * switch out if multiple party members are alive, else attack.
 */
export function decideBattleAction(ctx: BattleAiContext): BattleDecision {
  const myMaxHp = ctx.myActivePoke.maxHp || 1;
  const myHpRatio = ctx.myActivePoke.hp / myMaxHp;

  const healingItem = pickHealingItem(ctx.myItems);
  if (myHpRatio < 0.3 && healingItem) {
    return { type: "item", itemId: healingItem };
  }

  const aliveOthers = ctx.myParty.filter(
    (p) => p.uid !== ctx.myActivePoke.uid && p.hp > 0,
  );
  if (myHpRatio < 0.15 && aliveOthers.length > 0) {
    return { type: "switch", pokemonUid: aliveOthers[0].uid };
  }

  const move = highestPowerUsable(ctx.myActivePoke.moves);
  if (!move) {
    return {
      type: "attack",
      moveId: ctx.myActivePoke.moves[0]?.id ?? "tackle",
    };
  }
  return { type: "attack", moveId: move.id };
}

// ── Meta layer ────────────────────────────────────────────────────────────

export type MetaGoal = "collector" | "battler" | "explorer" | "balanced";

export interface MetaAiContext {
  state: AiState;
  goal?: MetaGoal;
}

export interface MetaDecision {
  /** "encounter" → seek wild battles; "heal" → restore party; "shop" → buy items. */
  type: "encounter" | "heal" | "shop" | "rest";
  detail?: Record<string, unknown>;
}

/**
 * High-level "what should the bot do next" decision. Crude on purpose —
 * scenario tests should override this when they need specific behaviour.
 */
export function decideMetaAction(ctx: MetaAiContext): MetaDecision {
  const lowHp = ctx.state.party.some(
    (p) => p.maxHp > 0 && p.hp / p.maxHp < 0.4,
  );
  if (lowHp) {
    return { type: "heal" };
  }

  const goal = ctx.goal ?? "balanced";
  if (goal === "collector" || goal === "explorer") {
    return { type: "encounter" };
  }
  if (goal === "battler") {
    return { type: "encounter", detail: { mode: "battle" } };
  }

  // balanced: if we have plenty of points and few healing items, shop
  const healingStock = HEALING_ITEMS.reduce(
    (sum, id) => sum + (ctx.state.inventory[id] ?? 0),
    0,
  );
  if (ctx.state.points >= 500 && healingStock < 3) {
    return { type: "shop", detail: { wants: "potion" } };
  }
  return { type: "encounter" };
}
