import { getSpeciesByName } from "./data-loader.js";
import { applyExpToPokemon } from "./growth.js";
import { incrementItem } from "./inventory-utils.js";
import { getPartyPokemon } from "./pokemon-state.js";
import { clearPendingEvolutionForPokemon, queuePendingEvolution } from "./pending-evolution.js";
import type {
  BattleDroppedItem,
  BattleRewardConfig,
  BattleRewards,
  OwnedPokemon,
  UserData,
  WildPokemon,
} from "../../../../shared/types.js";

/** EXP yield using the main-series formula: floor(baseExp * level / 7) * multiplier. */
export function calculateBattleExp(
  wild: Pick<WildPokemon, "species" | "level">,
  config: BattleRewardConfig,
): number {
  const baseExpYield = getSpeciesByName(wild.species)?.baseExpYield ?? 0;
  const raw = (baseExpYield * wild.level) / 7;
  return Math.max(0, Math.floor(raw * config.expMultiplier));
}

/** Battle money from a win, approximating main-series trainer prize money by level. */
export function calculateBattleMoney(
  wildLevel: number,
  config: BattleRewardConfig,
): number {
  return Math.max(0, Math.floor(wildLevel * config.moneyPerLevel) + config.moneyBase);
}

/**
 * Single weighted roll across the drop table. The table's total chance may be
 * under 1.0, in which case the remaining probability mass is "no drop".
 * Returns at most one dropped item. `random` is injectable for testing.
 */
export function rollItemDrop(
  config: BattleRewardConfig,
  random: () => number = Math.random,
): BattleDroppedItem | null {
  const table = config.dropTable ?? [];
  let roll = random();

  for (const entry of table) {
    if (roll < entry.chance) {
      const min = Math.max(1, entry.min ?? 1);
      const max = Math.max(min, entry.max ?? min);
      const qty = min + Math.floor(random() * (max - min + 1));
      return { item: entry.item, qty };
    }
    roll -= entry.chance;
  }

  return null;
}

/**
 * Grant all wild-battle win rewards to the user and active Pokemon, mutating
 * `user` in place. Returns the reward summary for the battle action response.
 */
export function grantBattleRewards(
  user: UserData,
  winner: OwnedPokemon,
  wild: Pick<WildPokemon, "species" | "level">,
  config: BattleRewardConfig,
  options: { now?: Date; random?: () => number } = {},
): BattleRewards {
  const random = options.random ?? Math.random;
  const now = options.now ?? new Date();

  const exp = calculateBattleExp(wild, config);
  const battleMoney = calculateBattleMoney(wild.level, config);
  const drop = rollItemDrop(config, random);

  user.battleMoney += battleMoney;

  const droppedItems: BattleDroppedItem[] = [];
  if (drop) {
    incrementItem(user.inventory, drop.item, drop.qty);
    droppedItems.push(drop);
  }

  const expResult = applyExpToPokemon(winner, exp, {
    party: getPartyPokemon(user),
    now,
    region: user.currentRegion ?? "default",
  });

  let evolvedInto: string | null = null;
  if (expResult.evolvedBranch) {
    clearPendingEvolutionForPokemon(user, winner.uid);
    evolvedInto = expResult.evolvedBranch.targetSpecies;
    if (!user.pokedex.includes(evolvedInto)) {
      user.pokedex.push(evolvedInto);
    }
  } else if (expResult.pendingBranches.length > 0) {
    queuePendingEvolution(user, winner, expResult.pendingBranches);
  }

  return {
    exp,
    battleMoney,
    droppedItems,
    leveledUp: expResult.leveled,
    newLevel: expResult.newLevel,
    evolvedInto,
  };
}
