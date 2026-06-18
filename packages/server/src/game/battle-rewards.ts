import { getSpeciesByName } from "./data-loader.js";
import { applyExpToPokemon } from "./growth.js";
import { incrementItem } from "./inventory-utils.js";
import { getPartyPokemon } from "./pokemon-state.js";
import { clearPendingEvolutionForPokemon, queuePendingEvolution } from "./pending-evolution.js";
import { queuePendingMoveLearns } from "./pending-move-learn.js";
import type {
  BattleDroppedItem,
  BattlePartyExp,
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
 * Apply `exp` to a single party member and resolve the user-level evolution
 * side-effects (pokedex updates / pending-evolution queue), mutating both the
 * Pokemon and `user`. Returns the per-Pokemon exp summary for the response.
 */
function grantExpToMember(
  user: UserData,
  pokemon: OwnedPokemon,
  exp: number,
  party: OwnedPokemon[],
  now: Date,
): BattlePartyExp {
  const expResult = applyExpToPokemon(pokemon, exp, {
    party,
    now,
    region: user.currentRegion ?? "default",
  });

  let evolvedInto: string | null = null;
  if (expResult.evolvedBranch) {
    clearPendingEvolutionForPokemon(user, pokemon.uid);
    evolvedInto = expResult.evolvedBranch.targetSpecies;
    if (!user.pokedex.includes(evolvedInto)) {
      user.pokedex.push(evolvedInto);
    }
  } else if (expResult.pendingBranches.length > 0) {
    queuePendingEvolution(user, pokemon, expResult.pendingBranches);
  }

  // 4개 한도를 넘겨 자동으로 못 배운 기술은 대기에 쌓아 플레이어가 결정하게 한다.
  if (expResult.pendingMoveLearns.length > 0) {
    queuePendingMoveLearns(user, pokemon.uid, expResult.pendingMoveLearns);
  }

  return {
    uid: pokemon.uid,
    species: pokemon.species,
    exp,
    leveledUp: expResult.leveled,
    newLevel: expResult.newLevel,
    evolvedInto,
  };
}

/**
 * Grant all wild-battle win rewards to the user, mutating `user` in place. EXP
 * is distributed the classic (gen-6+) way: every Pokemon that *participated*
 * (was sent out during the battle) and is still alive (hp>0) earns the FULL
 * yield — no division. Fainted (hp<=0) participants earn nothing. A single-
 * Pokemon battle therefore behaves exactly as before. `participants[0]` is the
 * headline (winner) used for the back-compat scalar reward fields.
 * Returns the reward summary for the battle action response.
 */
export function grantBattleRewards(
  user: UserData,
  participants: OwnedPokemon[],
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

  const party = getPartyPokemon(user);

  // 참여(필드에 나온) 포켓몬 중 살아있는 개체에게 각각 풀 EXP(분배 없음). 기절은 제외.
  const partyExp: BattlePartyExp[] = [];
  for (const member of participants) {
    if (member.hp <= 0) continue;
    partyExp.push(grantExpToMember(user, member, exp, party, now));
  }

  // 헤드라인(winner) — 첫 살아있는 참여자. 전원 기절 같은 예외는 participants[0]로 폴백.
  const headline = partyExp[0];
  return {
    exp,
    battleMoney,
    droppedItems,
    leveledUp: headline?.leveledUp ?? false,
    newLevel: headline?.newLevel ?? participants[0]?.level ?? 0,
    evolvedInto: headline?.evolvedInto ?? null,
    partyExp,
  };
}
