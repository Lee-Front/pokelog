import path from "node:path";
import fs from "node:fs/promises";
import { getConfig } from "../storage/config-store.js";
import { getDataDir } from "../paths.js";
import { getUser, isGitIntegration, normalizeRepoUrl, saveUser } from "../storage/user-store.js";
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
import { getRegion } from "../game/data-loader.js";
import { createEncounterEvent } from "../game/event-factory.js";
import { clearPendingEvolutionForPokemon, queuePendingEvolution } from "../game/pending-evolution.js";
import { queuePendingMoveLearns } from "../game/pending-move-learn.js";
import { getPartyPokemon } from "../game/pokemon-state.js";
import {
  cloneBareRepo,
  fetchRepo,
  getAllCommitsAcrossBranches,
  getCommitByteChanges,
  type CommitInfo,
  type GitTlsOptions,
} from "./git-client.js";
import type { GitIntegration, UserData } from "../../../../shared/types.js";
import { childLogger } from "../logger.js";

const log = childLogger("recompute");

export interface RecomputeResult {
  before: { points: number; totalExp: number };
  after: { points: number; totalExp: number };
  commitsApplied: number;
}

function getReposDir() {
  return path.join(getDataDir(), "repos");
}

function repoLocalDir(url: string): string {
  // Mirror polling-worker.repoLocalDir so recompute reuses the same bare clones.
  const name = url.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_");
  return path.join(getReposDir(), name + ".git");
}

async function ensureBareClone(
  url: string,
  authMode?: string,
  token?: string,
  tls?: GitTlsOptions,
): Promise<string> {
  const dir = repoLocalDir(url);
  try {
    await fs.access(dir);
  } catch {
    await cloneBareRepo(url, dir, authMode, token, tls);
  }
  return dir;
}

function gitTlsOptions(config: GitIntegration["config"]): GitTlsOptions {
  return {
    caCertPath: config.caCertPath,
    insecureSkipTls: config.insecureSkipTls,
  };
}

/**
 * Which of this user's emails attribute commits for a given git integration.
 * An empty integration `emails` list is a wildcard (matches every author on the
 * repo), mirroring userMatchesRepoCommit in user-store. Legacy git matchings
 * (account.matchings.git.emails) also count. Returns null for "wildcard".
 */
function integrationEmailMatcher(
  user: UserData,
  integration: GitIntegration,
): (authorEmail: string) => boolean {
  const legacy = user.account.matchings.git?.emails ?? [];
  const emails = integration.emails ?? [];
  // Wildcard: integration explicitly attributes all commits on the repo.
  if (emails.length === 0) return () => true;
  const allowed = new Set([...emails, ...legacy]);
  return (authorEmail: string) => allowed.has(authorEmail);
}

/**
 * Apply one commit's reward to a single in-memory user object. Mirrors
 * commit-processor.processCommit's per-user body, but operates on the passed
 * user (no reload, no save) so recompute can replay a whole history in memory
 * and persist once. `bytes` is precomputed so callers can skip zero-byte commits.
 */
function applyCommitReward(
  user: UserData,
  commit: CommitInfo,
  bytes: number,
  config: Awaited<ReturnType<typeof getConfig>>,
): void {
  const comboResult = judgeCombo(
    user.combo.lastCommitAt ? user.combo : null,
    bytes,
    commit.timestamp,
    config.rewards.combo,
  );
  user.combo = { count: comboResult.count, lastCommitAt: comboResult.lastCommitAt };

  const multiplier = getComboMultiplier(user.combo.count, config.rewards.combo);
  const reward = calculateReward(bytes, multiplier, config.rewards);
  user.points += reward.points;
  user.totalExp += reward.exp;
  const currentRegion = user.currentRegion ?? "default";

  // Distribute EXP to party pokemon (level-ups + evolutions), same as polling.
  if (user.party.length > 0) {
    const expPerPokemon = Math.floor(reward.exp / user.party.length);
    const partyPokemon = getPartyPokemon(user);
    for (const pokemon of partyPokemon) {
      if (!pokemon) continue;
      pokemon.exp += expPerPokemon;
      const result = checkLevelUp(pokemon);
      if (result.leveled) {
        pokemon.level = result.newLevel;
        const moveResult = applyLearnedMoves(pokemon, result.newMoves);
        if (moveResult.pending.length > 0) {
          queuePendingMoveLearns(user, pokemon.uid, moveResult.pending);
        }
        const newStats = calculateStatsForLevel(pokemon.species, result.newLevel, pokemon.nature);
        pokemon.maxHp = newStats.maxHp;
        pokemon.hp = Math.min(pokemon.hp, pokemon.maxHp);
        pokemon.stats = newStats.stats;
        const matchingBranches = getMatchingEvolutionBranches(pokemon.species, {
          level: result.newLevel,
          ...buildLevelEvolutionContext(pokemon, partyPokemon, {
            now: new Date(commit.timestamp),
            region: currentRegion,
          }),
        });
        if (matchingBranches.length === 1) {
          const evolvedBranch = matchingBranches[0];
          clearPendingEvolutionForPokemon(user, pokemon.uid);
          evolvePokemon(pokemon, evolvedBranch.targetSpecies, evolvedBranch.targetVariantId);
          if (!user.pokedex.includes(evolvedBranch.targetSpecies)) {
            user.pokedex.push(evolvedBranch.targetSpecies);
          }
        } else if (matchingBranches.length > 1) {
          queuePendingEvolution(user, pokemon, matchingBranches);
        }
      }
    }
  }

  // Encounter accounting.
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

  user.log.push({
    type: "reward",
    commit: commit.hash,
    repo: "recompute",
    bytes,
    exp: reward.exp,
    points: reward.points,
    comboMultiplier: multiplier,
    timestamp: new Date().toISOString(),
  });
  if (user.log.length > 200) user.log = user.log.slice(-200);
}

/**
 * Recompute a single user's points/exp from their git commit history.
 *
 * Why this exists: the #19 reset bug left some users with zeroed balances, and
 * we need an operational tool to rebuild a user from their commits.
 *
 * Why it does NOT touch syncState: syncState is keyed per repo, not per user, so
 * resetting a repo's baseline would make the next poll re-process EVERY user on
 * that repo from scratch — double-rewarding the others. Instead we recompute
 * this user directly: clone/fetch their repos, walk the full history, keep only
 * commits matching this user's integration emails, and replay the reward logic
 * in memory. syncState is left untouched, so other users are entirely unaffected
 * and this user's own subsequent polls only see genuinely new commits (the tips
 * are unchanged, so no double-count for them either).
 *
 * points/totalExp/combo/encounterCeiling are reset to a clean baseline first;
 * non-commit points (admin grants, etc.) are intentionally discarded — the tool
 * reconstructs the commit-derived balance only. The single save passes a reason
 * so the saveUser balance-regression guard does not warn on the intended drop.
 */
export async function recomputeUser(userId: string): Promise<RecomputeResult> {
  const user = await getUser(userId);
  if (!user) {
    throw new Error("유저 없음");
  }

  const before = { points: user.points, totalExp: user.totalExp };
  const config = await getConfig();

  // Reset commit-derived state to a clean baseline before replaying.
  user.points = 0;
  user.totalExp = 0;
  user.combo = { count: 0, lastCommitAt: null };
  user.encounterCeiling = { accumulatedBytes: 0 };

  // Collect this user's commits across every git integration repo, deduplicated
  // by commit hash (a commit could appear via two integrations on the same repo)
  // and sorted chronologically so combo timing matches a real forward poll.
  const seen = new Set<string>();
  const pending: { commit: CommitInfo; bytes: number }[] = [];

  for (const integration of user.integrations) {
    if (!isGitIntegration(integration)) continue;
    if (!integration.config.repoUrl?.trim()) continue;

    const git = integration as GitIntegration;
    const tls = gitTlsOptions(git.config);
    let repoDir: string;
    try {
      repoDir = await ensureBareClone(git.config.repoUrl, git.config.authMode, git.config.token, tls);
      await fetchRepo(repoDir, tls);
    } catch (err) {
      log.error({ err, userId, repoUrl: normalizeRepoUrl(git.config.repoUrl) }, "recompute: repo fetch failed");
      continue;
    }

    const matchesEmail = integrationEmailMatcher(user, git);
    const commits = await getAllCommitsAcrossBranches(repoDir);
    for (const commit of commits) {
      if (commit.parentCount >= 2) continue; // skip merges, same as polling
      if (!matchesEmail(commit.authorEmail)) continue;
      if (seen.has(commit.hash)) continue;
      seen.add(commit.hash);
      const bytes = await getCommitByteChanges(repoDir, commit.hash);
      if (bytes === 0) continue;
      pending.push({ commit, bytes });
    }
  }

  pending.sort(
    (a, b) => new Date(a.commit.timestamp).getTime() - new Date(b.commit.timestamp).getTime(),
  );

  for (const { commit, bytes } of pending) {
    applyCommitReward(user, commit, bytes, config);
  }

  // Single intentional save; reason skips the balance-regression warning.
  await saveUser(user, "admin-recompute");

  log.info(
    { userId, before, after: { points: user.points, totalExp: user.totalExp }, commitsApplied: pending.length },
    "recompute: done",
  );

  return {
    before,
    after: { points: user.points, totalExp: user.totalExp },
    commitsApplied: pending.length,
  };
}
