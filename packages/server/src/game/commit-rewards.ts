import type { ServerConfig, UserData } from "../../../../shared/types.js";
import { calculateReward } from "./reward.js";
import { judgeCombo, getComboMultiplier } from "./combo.js";
import { checkEncounter, selectWildPokemon } from "./encounter.js";
import { createWildPokemon } from "./pokemon-factory.js";
import {
  applyLearnedMoves,
  buildLevelEvolutionContext,
  checkLevelUp,
  evolvePokemon,
  getMatchingEvolutionBranches,
} from "./growth.js";
import { calculateStatsForLevel } from "./pokemon-stats.js";
import { getRegion } from "./data-loader.js";
import { createEncounterEvent } from "./event-factory.js";
import { clearPendingEvolutionForPokemon, queuePendingEvolution } from "./pending-evolution.js";
import { getPartyPokemon } from "./pokemon-state.js";

/**
 * Minimal commit metadata needed to apply rewards. Callers that already have
 * a richer CommitInfo can just pass that same object; the shape here is
 * intentionally narrower than the git-client CommitInfo so admin test
 * commits (which only have a synthetic timestamp/hash) can also use it.
 */
export interface CommitRewardInput {
  /** ISO timestamp driving the combo judgement and evolution "now" */
  timestamp: string;
}

export interface PartyLevelUp {
  uid: string;
  species: string;
  newLevel: number;
  evolved?: { targetSpecies: string; targetVariantId?: string | null };
  queuedPendingEvolution?: boolean;
}

export interface CommitEncounterInfo {
  species: string;
  level: number;
}

export interface CommitRewardOutcome {
  /** Combo count AFTER this commit is applied. */
  comboCount: number;
  /** Multiplier applied to the EXP/points reward. */
  multiplier: number;
  /** EXP awarded (total, before party distribution). */
  expAwarded: number;
  /** Points credited to the user. */
  pointsAwarded: number;
  /** Per-pokemon level-up results for the party. */
  partyLevelUps: PartyLevelUp[];
  /** Encounter event info if an encounter was rolled this commit. */
  encounter: CommitEncounterInfo | null;
}

/**
 * Apply all the shared commit-reward side effects to `user`:
 *   - update combo
 *   - credit points + totalExp
 *   - distribute EXP across party and trigger level-ups / evolutions
 *   - roll for a wild encounter and push the encounter event if it fires
 *
 * This mutates `user` in place. The caller is responsible for persistence,
 * log entries (since admin-test and real-commit paths write different log
 * shapes), and any auth/error handling around the invocation.
 */
export function applyCommitRewards(
  user: UserData,
  bytes: number,
  config: ServerConfig,
  commit: CommitRewardInput,
): CommitRewardOutcome {
  // ── Combo judgement ──
  const comboResult = judgeCombo(
    user.combo.lastCommitAt ? user.combo : null,
    bytes,
    commit.timestamp,
    config.rewards.combo,
  );
  user.combo = {
    count: comboResult.count,
    lastCommitAt: comboResult.lastCommitAt,
  };
  const multiplier = getComboMultiplier(user.combo.count, config.rewards.combo);

  // ── Base reward ──
  const reward = calculateReward(bytes, multiplier, config.rewards);
  user.points += reward.points;
  user.totalExp += reward.exp;
  const currentRegion = user.currentRegion ?? "default";

  // ── Party EXP + level-ups + evolution ──
  const partyLevelUps: PartyLevelUp[] = [];
  if (user.party.length > 0) {
    const expPerPokemon = Math.floor(reward.exp / user.party.length);
    const partyPokemon = getPartyPokemon(user);

    for (const pokemon of partyPokemon) {
      if (!pokemon) continue;
      pokemon.exp += expPerPokemon;
      const result = checkLevelUp(pokemon);
      if (!result.leveled) continue;

      pokemon.level = result.newLevel;
      applyLearnedMoves(pokemon, result.newMoves);
      const newStats = calculateStatsForLevel(
        pokemon.species,
        result.newLevel,
        pokemon.nature,
        pokemon.variantId ?? null,
        pokemon.ivs,
      );
      pokemon.maxHp = newStats.maxHp;
      pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
      pokemon.stats = newStats.stats;

      const matchingBranches = getMatchingEvolutionBranches(
        pokemon.species,
        {
          level: result.newLevel,
          ...buildLevelEvolutionContext(pokemon, partyPokemon, {
            now: new Date(commit.timestamp),
            region: currentRegion,
          }),
        },
      );

      const entry: PartyLevelUp = {
        uid: pokemon.uid,
        species: pokemon.species,
        newLevel: result.newLevel,
      };

      if (matchingBranches.length === 1) {
        const evolvedBranch = matchingBranches[0];
        clearPendingEvolutionForPokemon(user, pokemon.uid);
        evolvePokemon(pokemon, evolvedBranch.targetSpecies, evolvedBranch.targetVariantId);
        if (!user.pokedex.includes(evolvedBranch.targetSpecies)) {
          user.pokedex.push(evolvedBranch.targetSpecies);
        }
        entry.evolved = {
          targetSpecies: evolvedBranch.targetSpecies,
          targetVariantId: evolvedBranch.targetVariantId,
        };
      } else if (matchingBranches.length > 1) {
        queuePendingEvolution(user, pokemon, matchingBranches);
        entry.queuedPendingEvolution = true;
      }
      partyLevelUps.push(entry);
    }
  }

  // ── Encounter ──
  const encounterResult = checkEncounter(
    user.encounterCeiling.accumulatedBytes,
    bytes,
    config.rewards.encounter.baseChance,
    multiplier,
    config.rewards.encounter.ceilingBytes,
  );
  user.encounterCeiling.accumulatedBytes = encounterResult.newCeiling;

  let encounter: CommitEncounterInfo | null = null;
  if (encounterResult.encountered) {
    const regionData = getRegion(currentRegion);
    const pick = selectWildPokemon(regionData);
    const wildPokemon = createWildPokemon(pick.species, pick.level);
    const event = createEncounterEvent(wildPokemon, config.rewards.encounter.timeLimitHours);
    user.pendingEvents.push(event);
    encounter = { species: pick.species, level: pick.level };
  }

  return {
    comboCount: user.combo.count,
    multiplier,
    expAwarded: reward.exp,
    pointsAwarded: reward.points,
    partyLevelUps,
    encounter,
  };
}
