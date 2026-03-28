import { findUserByEmail, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { calculateReward } from "../game/reward.js";
import { judgeCombo, getComboMultiplier } from "../game/combo.js";
import { checkEncounter, selectWildPokemon } from "../game/encounter.js";
import { createWildPokemon } from "../game/pokemon-factory.js";
import { getCommitByteChanges } from "./git-client.js";
import type { CommitInfo } from "./git-client.js";
import { getRegion } from "../game/data-loader.js";
import crypto from "node:crypto";

export async function processCommit(
  commit: CommitInfo,
  repoDir: string,
): Promise<void> {
  // Skip merge commits
  if (commit.parentCount >= 2) return;

  // Find user by email
  const user = await findUserByEmail(commit.authorEmail);
  if (!user) return;

  const config = await getConfig();

  // Calculate byte changes
  const bytes = await getCommitByteChanges(repoDir, commit.hash);
  if (bytes === 0) return;

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

  // Distribute EXP to party pokemon
  if (user.party.length > 0) {
    const expPerPokemon = Math.floor(reward.exp / user.party.length);
    for (const uid of user.party) {
      const pokemon = user.pokemon.find((p) => p.uid === uid);
      if (pokemon) {
        pokemon.exp += expPerPokemon;
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
    const regionData = getRegion("default");
    const wildInfo = selectWildPokemon(regionData);
    const wildPokemon = createWildPokemon(wildInfo.species, wildInfo.level);

    const event = {
      id: `evt-${crypto.randomUUID()}`,
      type: "wild_encounter" as const,
      pokemon: wildPokemon,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() + config.rewards.encounter.timeLimitHours * 3600000,
      ).toISOString(),
    };
    user.pendingEvents.push(event);
  }

  // Add log entry (keep max 200)
  user.log.push({
    type: "reward",
    commit: commit.hash,
    repo: repoDir,
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
