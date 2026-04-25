import type { OwnedPokemon, PokemonMove, PrimaryStatus, ShopItem, UserData, VitaminStatKey } from "../../../../shared/types.js";
import { getItems, getMoveById, getSpeciesByName } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { evolvePokemon, getEvolutionItemUseTarget } from "./growth.js";
import { decrementItem, healPokemon } from "./inventory-utils.js";
import { clearPendingEvolutionForPokemon } from "./pending-evolution.js";
import { getDisplaySpeciesName } from "./pokemon-state.js";
import { adjustFriendship } from "./friendship.js";
import { MAX_MOVES } from "../../../../shared/types.js";

export { GameRuleError as ItemUseError };

export interface ItemUseResult {
  kind: "healing" | "evolution" | "vitamin" | "pp-boost" | "status-cure";
  item: string;
  itemName: string;
  pokemon: OwnedPokemon;
  previousSpecies?: string;
  vitaminStat?: VitaminStatKey;
  newVitaminCount?: number;
  moveId?: string;
  newMaxPp?: number;
  curedStatus?: PrimaryStatus;
  hpRestored?: number;
}

/**
 * Items that cure a single specific status, plus full-heal which clears
 * any status. PokeAPI item ids are kebab-case (e.g. "burn-heal"); we use
 * the same canonical ids here so admin-granted items line up with the
 * upstream catalog. Note: as of 2026-04 these items are NOT shipped in
 * items.json — they need to be synced from PokeAPI before normal users
 * can obtain them via shop. Admin grant works today.
 */
const STATUS_CURE_MAP: Record<string, PrimaryStatus> = {
  "burn-heal": "burn",
  "ice-heal": "freeze",
  awakening: "sleep",
  "paralyze-heal": "paralysis",
  antidote: "poison",
};

function clearStatusFields(pokemon: OwnedPokemon): void {
  pokemon.statusCondition = null;
  pokemon.sleepTurns = undefined;
  // toxicCounter lives on the PvP runtime pokemon shape; OwnedPokemon does
  // not declare it, but we clear via cast to keep state consistent if it
  // was assigned during a tower run snapshot.
  (pokemon as unknown as { toxicCounter?: number }).toxicCounter = undefined;
}

export const VITAMIN_MAX_APPLICATIONS = 10;
const VITAMIN_STAT_INCREMENT = 2; // +2 per application. 10 uses = +20 — roughly canonical (~+25 at lv100 from 100 EV).
const HP_UP_INCREMENT = 3; // HP scales more per EV so give a slightly bigger step.
const PP_UP_MAX_INCREMENTS = 3;

function ensureAppliedVitamins(pokemon: OwnedPokemon): NonNullable<OwnedPokemon["appliedVitamins"]> {
  if (!pokemon.appliedVitamins) {
    pokemon.appliedVitamins = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
  }
  return pokemon.appliedVitamins;
}

function applyVitamin(pokemon: OwnedPokemon, stat: VitaminStatKey): number {
  const applied = ensureAppliedVitamins(pokemon);
  if (applied[stat] >= VITAMIN_MAX_APPLICATIONS) {
    throw new GameRuleError(`${stat} 영양제는 더 이상 효과가 없습니다.`);
  }

  applied[stat] += 1;
  if (stat === "hp") {
    pokemon.maxHp += HP_UP_INCREMENT;
    pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + HP_UP_INCREMENT);
  } else {
    pokemon.stats[stat] += VITAMIN_STAT_INCREMENT;
  }

  return applied[stat];
}

function getItemDisplayName(item: string, shopItem?: ShopItem): string {
  if (shopItem?.name) {
    return shopItem.name;
  }

  return getItems().find((entry) => entry.id === item)?.name ?? item;
}

function getPokemonDisplayName(pokemon: OwnedPokemon): string {
  if (pokemon.nickname) {
    return pokemon.nickname;
  }

  return getDisplaySpeciesName(pokemon.species);
}

/**
 * Canon PP Up: each use adds 20% of the move's base PP, capped at 3
 * applications per move (= +60% baseline PP). PP Max jumps straight to the
 * cap. We derive the baseline PP from (current maxPp − prior bumps) and
 * track applications on move.ppUpsUsed.
 */
function applyPpBoost(
  pokemon: OwnedPokemon,
  kind: NonNullable<ShopItem["ppBoost"]>,
  moveId: string,
): { moveId: string; newMaxPp: number } {
  const move = pokemon.moves.find((entry) => entry.id === moveId);
  if (!move) {
    throw new GameRuleError("해당 포켓몬은 그 기술을 배우지 않았습니다.");
  }

  const used = move.ppUpsUsed ?? 0;
  if (used >= PP_UP_MAX_INCREMENTS) {
    throw new GameRuleError("이 기술의 PP는 이미 최대입니다.");
  }

  // Reconstruct baseline PP before any PP Up applications.
  const baselinePp = Math.floor((move.maxPp * 5) / (5 + used));
  const increment = Math.max(1, Math.floor(baselinePp / 5));

  const add = kind === "max" ? (PP_UP_MAX_INCREMENTS - used) : 1;
  move.maxPp += increment * add;
  move.pp = Math.min(move.maxPp, move.pp + increment * add);
  move.ppUpsUsed = used + add;
  return { moveId, newMaxPp: move.maxPp };
}

export interface UseInventoryItemOptions {
  /** Required when using pp-up / pp-max. */
  moveId?: string;
}

export function useInventoryItem(
  user: UserData,
  item: string,
  pokemonUid: string,
  shopItem?: ShopItem,
  options: UseInventoryItemOptions = {},
): ItemUseResult {
  if (!user.inventory[item] || user.inventory[item] <= 0) {
    throw new GameRuleError("Item not found in inventory.");
  }

  const pokemon = user.pokemon.find((entry) => entry.uid === pokemonUid);
  if (!pokemon) {
    throw new GameRuleError("Pokemon not found in party.", 404);
  }

  const itemName = getItemDisplayName(item, shopItem);

  // Single-status cures: only valid when the pokemon has the matching
  // status. Reject otherwise so we don't silently consume the item.
  if (Object.prototype.hasOwnProperty.call(STATUS_CURE_MAP, item)) {
    const cure = STATUS_CURE_MAP[item];
    if (pokemon.statusCondition !== cure) {
      throw new GameRuleError(`${getPokemonDisplayName(pokemon)}은(는) 해당 상태이상에 걸려있지 않습니다.`);
    }
    clearStatusFields(pokemon);
    decrementItem(user.inventory, item);
    return {
      kind: "status-cure",
      item,
      itemName,
      pokemon,
      curedStatus: cure,
    };
  }

  // Full-heal cures any status (but not HP).
  if (item === "full-heal") {
    if (!pokemon.statusCondition) {
      throw new GameRuleError(`${getPokemonDisplayName(pokemon)}에게 치료할 상태이상이 없습니다.`);
    }
    const cured = pokemon.statusCondition;
    clearStatusFields(pokemon);
    decrementItem(user.inventory, item);
    return {
      kind: "status-cure",
      item,
      itemName,
      pokemon,
      curedStatus: cured,
    };
  }

  // Full-restore heals HP to max AND cures any status. Valid if either
  // HP is below max or there is a status to cure (so we don't waste the
  // item on a fully-healthy pokemon).
  if (item === "full-restore") {
    const hadStatus = pokemon.statusCondition != null;
    const wasInjured = pokemon.hp < pokemon.maxHp;
    if (!hadStatus && !wasInjured) {
      throw new GameRuleError(`${getPokemonDisplayName(pokemon)}은(는) 회복이 필요하지 않습니다.`);
    }
    const cured = pokemon.statusCondition ?? undefined;
    const hpBefore = pokemon.hp;
    clearStatusFields(pokemon);
    pokemon.hp = pokemon.maxHp;
    decrementItem(user.inventory, item);
    adjustFriendship(pokemon, "heal-item");
    return {
      kind: "status-cure",
      item,
      itemName,
      pokemon,
      curedStatus: cured,
      hpRestored: pokemon.hp - hpBefore,
    };
  }

  if (shopItem?.healAmount) {
    if (pokemon.hp >= pokemon.maxHp) {
      throw new GameRuleError("Pokemon does not need healing.");
    }

    decrementItem(user.inventory, item);
    healPokemon(pokemon, shopItem.healAmount);
    adjustFriendship(pokemon, "heal-item");

    return {
      kind: "healing",
      item,
      itemName,
      pokemon,
    };
  }

  if (shopItem?.vitaminStat) {
    const newCount = applyVitamin(pokemon, shopItem.vitaminStat);
    decrementItem(user.inventory, item);
    adjustFriendship(pokemon, "vitamin");
    return {
      kind: "vitamin",
      item,
      itemName,
      pokemon,
      vitaminStat: shopItem.vitaminStat,
      newVitaminCount: newCount,
    };
  }

  if (shopItem?.ppBoost) {
    if (!options.moveId) {
      throw new GameRuleError("PP 강화 대상 기술을 선택해야 합니다.");
    }
    const result = applyPpBoost(pokemon, shopItem.ppBoost, options.moveId);
    decrementItem(user.inventory, item);
    return {
      kind: "pp-boost",
      item,
      itemName,
      pokemon,
      moveId: result.moveId,
      newMaxPp: result.newMaxPp,
    };
  }

  const evolutionResult = getEvolutionItemUseTarget(pokemon.species, item);
  if (!evolutionResult) {
    throw new GameRuleError(`Cannot use ${itemName} on ${getPokemonDisplayName(pokemon)}.`);
  }

  const previousSpecies = pokemon.species;
  decrementItem(user.inventory, item);
  clearPendingEvolutionForPokemon(user, pokemon.uid);
  evolvePokemon(pokemon, evolutionResult.targetSpecies, evolutionResult.targetVariantId);

  if (!user.pokedex.includes(evolutionResult.targetSpecies)) {
    user.pokedex.push(evolutionResult.targetSpecies);
  }

  return {
    kind: "evolution",
    item,
    itemName,
    pokemon,
    previousSpecies,
  };
}

function buildMoveSlot(moveId: string): PokemonMove {
  const moveData = getMoveById(moveId);
  const pp = moveData?.pp ?? 10;
  return { id: moveId, pp, maxPp: pp };
}

/**
 * Resolve the move id taught by a TM-style item id. We support the
 * canonical PokeAPI `tm-{move-id}` shape (e.g. `tm-flamethrower`). Note:
 * as of 2026-04 items.json does NOT ship TMs — so unless an admin
 * grants a `tm-*` item, this code path is unreachable for normal users.
 * Returns `null` if the id doesn't look like a TM.
 */
export function resolveTmMoveId(itemId: string): string | null {
  if (!itemId.startsWith("tm-")) return null;
  const moveId = itemId.slice(3);
  if (!moveId) return null;
  return moveId;
}

export interface UseTmResult {
  ok: boolean;
  /** Set when the call needs the user to pick a move to forget. */
  needsForgetMove?: boolean;
  currentMoves?: string[];
  learned?: string;
  /** When ok=false, a human-readable Korean error string. */
  error?: string;
}

/**
 * Teach a pokemon a move from a TM. If the pokemon already has 4 moves
 * and `forgetMoveId` is not provided, we return `needsForgetMove=true`
 * with the current move ids and DO NOT consume the TM. Once the user
 * calls again with `forgetMoveId`, we replace that slot.
 *
 * On success: TM is decremented (TMs in this game are consumable for
 * simplicity; canon Gen 5+ TMs are reusable).
 */
export function useTmOnPokemon(
  user: UserData,
  pokemonUid: string,
  tmItemId: string,
  forgetMoveId?: string,
): UseTmResult {
  const owned = user.inventory[tmItemId] ?? 0;
  if (owned <= 0) {
    return { ok: false, error: "TM이 인벤토리에 없습니다." };
  }

  const pokemon = user.pokemon.find((p) => p.uid === pokemonUid)
    ?? user.storage.find((p) => p.uid === pokemonUid);
  if (!pokemon) {
    return { ok: false, error: "포켓몬을 찾을 수 없습니다." };
  }

  const moveId = resolveTmMoveId(tmItemId);
  if (!moveId) {
    return { ok: false, error: "유효한 TM이 아닙니다." };
  }

  const speciesData = getSpeciesByName(pokemon.species);
  if (!speciesData) {
    return { ok: false, error: "종족 데이터를 찾을 수 없습니다." };
  }
  if (!speciesData.learnset.tm.includes(moveId)) {
    return { ok: false, error: `${pokemon.species}은(는) 이 기술을 TM으로 배울 수 없습니다.` };
  }

  if (pokemon.moves.some((m) => m.id === moveId)) {
    return { ok: false, error: "이미 이 기술을 알고 있습니다." };
  }

  if (pokemon.moves.length >= MAX_MOVES) {
    if (!forgetMoveId) {
      return {
        ok: false,
        needsForgetMove: true,
        currentMoves: pokemon.moves.map((m) => m.id),
      };
    }
    const idx = pokemon.moves.findIndex((m) => m.id === forgetMoveId);
    if (idx < 0) {
      return { ok: false, error: "잊을 기술을 알지 못합니다." };
    }
    pokemon.moves[idx] = buildMoveSlot(moveId);
  } else {
    pokemon.moves.push(buildMoveSlot(moveId));
  }

  decrementItem(user.inventory, tmItemId);
  return { ok: true, learned: moveId };
}

export interface LearnPendingResult {
  ok: boolean;
  error?: string;
  learned?: string;
  forgot?: string;
}

/**
 * Resolve a pending level-up move learn that was queued because the
 * pokemon already had 4 moves at the time. The user picks a move to
 * forget; we replace it with the queued move and clear `pendingMoveLearn`.
 *
 * If `forgetMoveId` is null/undefined, the user is declining the move —
 * we just clear the pending state.
 */
export function learnPendingMove(
  pokemon: OwnedPokemon,
  forgetMoveId: string | null | undefined,
): LearnPendingResult {
  const pending = pokemon.pendingMoveLearn;
  if (!pending) {
    return { ok: false, error: "대기 중인 기술이 없습니다." };
  }

  // Decline path: clear pending without learning.
  if (forgetMoveId == null) {
    delete pokemon.pendingMoveLearn;
    return { ok: true };
  }

  if (pokemon.moves.some((m) => m.id === pending)) {
    // Edge case: pokemon already learned the move via another path.
    delete pokemon.pendingMoveLearn;
    return { ok: false, error: "이미 이 기술을 알고 있습니다." };
  }

  if (pokemon.moves.length < MAX_MOVES) {
    // Slot opened up since the move was queued — just add it.
    pokemon.moves.push(buildMoveSlot(pending));
    delete pokemon.pendingMoveLearn;
    return { ok: true, learned: pending };
  }

  const idx = pokemon.moves.findIndex((m) => m.id === forgetMoveId);
  if (idx < 0) {
    return { ok: false, error: "잊을 기술을 알지 못합니다." };
  }

  pokemon.moves[idx] = buildMoveSlot(pending);
  delete pokemon.pendingMoveLearn;
  return { ok: true, learned: pending, forgot: forgetMoveId };
}
