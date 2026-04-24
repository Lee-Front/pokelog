/**
 * Per-user in-process mutex for serializing read-modify-write cycles on
 * the same user's JSON file. The project stores each user as a single
 * file; concurrent getUser → mutate → saveUser flows can otherwise race
 * and lose updates because there is no database-level transaction.
 *
 * Usage:
 *
 *   await withUserLock(userId, async () => {
 *     const user = await getUser(userId);
 *     if (!user) return;
 *     // mutations
 *     await saveUser(user);
 *   });
 *
 * This only guards writers within the SAME Node process. It does not
 * help with multi-instance deployments; that would need an external
 * lock service or a real database.
 */

const locks = new Map<string, Promise<unknown>>();

export async function withUserLock<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = locks.get(userId) ?? Promise.resolve();
  // Chain on both success and failure of the previous holder so a
  // throwing critical section does not permanently break the lock.
  const next = prev.then(fn, fn);
  locks.set(userId, next);
  try {
    return (await next) as T;
  } finally {
    // Clean up only if no newer waiter has replaced our entry — this
    // keeps the map size bounded when activity dies down.
    if (locks.get(userId) === next) {
      locks.delete(userId);
    }
  }
}
