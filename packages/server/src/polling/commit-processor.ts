import { getUsersForRepoCommit, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { getUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { getCommitByteChanges } from "./git-client.js";
import type { CommitInfo } from "./git-client.js";
import { applyCommitRewards } from "../game/commit-rewards.js";
import type { ServerConfig } from "../../../../shared/types.js";

export async function processCommit(
  commit: CommitInfo,
  repoDir: string,
  repoUrl: string,
  /**
   * Optional preloaded config. The polling loop reads config once per
   * cycle and passes it in to avoid re-reading the JSON file for every
   * commit in a batch. If omitted we fall back to a fresh read for
   * ergonomic one-off callers (tests, manual admin triggers).
   */
  config?: ServerConfig,
): Promise<void> {
  // Skip merge commits
  if (commit.parentCount >= 2) return;

  const matchedUsers = await getUsersForRepoCommit(repoUrl, commit.authorEmail);
  if (matchedUsers.length === 0) return;

  const resolvedConfig = config ?? (await getConfig());

  // Calculate byte changes
  const bytes = await getCommitByteChanges(repoDir, commit.hash);
  if (bytes === 0) return;

  for (const matchedUser of matchedUsers) {
    const userId = matchedUser.account.id;
    // Serialize updates per-user so simultaneous commit processing and
    // HTTP handlers (battle, shop, …) cannot race and lose updates.
    // We re-read the user INSIDE the lock — the copy we pulled from
    // getUsersForRepoCommit may be stale by the time the lock lets us in.
    await withUserLock(userId, async () => {
      const user = await getUser(userId);
      if (!user) return;

      const outcome = applyCommitRewards(user, bytes, resolvedConfig, {
        timestamp: commit.timestamp,
      });

      // Add log entry (keep max 200)
      user.log.push({
        type: "reward",
        commit: commit.hash,
        repo: repoUrl,
        bytes,
        exp: outcome.expAwarded,
        points: outcome.pointsAwarded,
        comboMultiplier: outcome.multiplier,
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
    });
  }
}
