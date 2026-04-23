import { getUsersForRepoCommit, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { calculateReward } from "../game/reward.js";
import { judgeCombo, getComboMultiplier } from "../game/combo.js";
import { checkEncounter, selectWildPokemon } from "../game/encounter.js";
import { createWildPokemon } from "../game/pokemon-factory.js";
import {
  applyLearnedMoves,
  buildLevelEvolutionContext,
  checkLevelUp,
  evolvePokemon,
  getMatchingEvolutionBranches,
} from "../game/growth.js";
import { calculateStatsForLevel } from "../game/pokemon-stats.js";
import { getCommitByteChanges } from "./git-client.js";
import type { CommitInfo } from "./git-client.js";
import { getRegion } from "../game/data-loader.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { clearPendingEvolutionForPokemon, queuePendingEvolution } from "../game/pending-evolution.js";
import { getPartyPokemon } from "../game/pokemon-state.js";

export async function processCommit(
  commit: CommitInfo,
  repoDir: string,
  repoUrl: string,
): Promise<void> {
  // Skip merge commits
  if (commit.parentCount >= 2) return;

  const users = await getUsersForRepoCommit(repoUrl, commit.authorEmail);
  if (users.length === 0) return;

  const config = await getConfig();

  // Calculate byte changes
  const bytes = await getCommitByteChanges(repoDir, commit.hash);
  if (bytes === 0) return;

  for (const user of users) {
    // Update combo
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

    // Get combo multiplier
    const multiplier = getComboMultiplier(user.combo.count, config.rewards.combo);

    // Calculate rewards
    const reward = calculateReward(bytes, multiplier, config.rewards);

    // Apply rewards
    user.points += reward.points;
    user.totalExp += reward.exp;
    const currentRegion = user.currentRegion ?? "default";

    // Distribute EXP to party pokemon
    if (user.party.length > 0) {
      const expPerPokemon = Math.floor(reward.exp / user.party.length);
      const partyPokemon = getPartyPokemon(user);

      for (const pokemon of partyPokemon) {
        if (pokemon) {
          pokemon.exp += expPerPokemon;
          const result = checkLevelUp(pokemon);
          if (result.leveled) {
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
            if (matchingBranches.length === 1) {
              const evolvedBranch = matchingBranches[0];
              clearPendingEvolutionForPokemon(user, pokemon.uid);
              evolvePokemon(pokemon, evolvedBranch.targetSpecies, evolvedBranch.targetVariantId);
              if (!user.pokedex.includes(evolvedBranch.targetSpecies)) user.pokedex.push(evolvedBranch.targetSpecies);
            } else if (matchingBranches.length > 1) {
              queuePendingEvolution(user, pokemon, matchingBranches);
            }
          }
        }
      }
    }

    // Check encounter
    const encounterResult = checkEncounter(
      user.encounterCeiling.accumulatedBytes,
      bytes,
      config.rewards.encounter.baseChance,
      multiplier,
      config.rewards.encounter.ceilingBytes,
    );
    user.encounterCeiling.accumulatedBytes = encounterResult.newCeiling;

    if (encounterResult.encountered) {
      const regionData = getRegion(currentRegion);
      const wildInfo = selectWildPokemon(regionData);
      const wildPokemon = createWildPokemon(wildInfo.species, wildInfo.level);

      const event = createEncounterEvent(wildPokemon, config.rewards.encounter.timeLimitHours);
      user.pendingEvents.push(event);
    }

    // Add log entry (keep max 200)
    user.log.push({
      type: "reward",
      commit: commit.hash,
      repo: repoUrl,
      bytes,
      exp: reward.exp,
      points: reward.points,
      comboMultiplier: multiplier,
      timestamp: new Date().toISOString(),
    });
    if (user.log.length > 200) {
      user.log = user.log.slice(-200);
    }

    // Remove expired events
    const now = Date.now();
    user.pendingEvents = user.pendingEvents.filter(
      (e) => new Date(e.expiresAt).getTime() > now,
    );

    await saveUser(user);
  }
}
