# Known Limitations

This document records architectural limitations that the current codebase
does not address, along with pointers to the tests that pin the observed
behavior. When a limitation is fixed, flip the relevant test assertion
and delete the entry here.

## File-based storage race conditions

The server stores each user's state as a single JSON file at
`data/users/<id>.json`. Reads and writes use
`packages/server/src/storage/json-store.ts`:

- `readJson` — plain `fs.readFile` + `JSON.parse`.
- `writeJson` — writes to `<file>.<uuid>.tmp` then atomically
  `fs.rename` to the real path.

The rename is atomic against torn writes, so concurrent writers can never
produce a partially-written JSON file on disk. The underlying storage
layer still has no compare-and-swap, so naked concurrent
read-modify-write on the same user file would silently lose one update:

```
T1: read  (points = 0)
T2: read  (points = 0)
T1: write (points = 100)     // T1 wins
T2: write (points = 200)     // overwrites T1 — 100 is lost
```

**Status: mitigated within a single Node process.** Every mutating
route now wraps its `getUser → mutate → saveUser` block in
`withUserLock(userId, ...)` from
`packages/server/src/storage/user-mutex.ts`. Trade endpoints and other
two-user mutations take both per-user locks in deterministic order
(sorted by id, lower first) so two trades involving the same pair
cannot deadlock AB/BA. With the lock, additive RMW cycles converge
correctly — see the `withUserLock serializes same-user additive writes`
case in `concurrency.test.ts`.

**Remaining gap — multi-instance deployments.** `withUserLock` is an
in-process `Map<string, Promise>`; it does NOT serialize writers across
multiple Node processes (or pods, or replicas). If the server is ever
horizontally scaled, two replicas hitting the same user file can still
lose updates. Fixing that requires an external lock service (Redis,
Postgres advisory lock, etc.) or moving the store to a real database
with transactions.

**Tests:**

- `packages/server/tests/integration/concurrency.test.ts` — pins the
  current behavior: independent users safe, naked same-user RMW (no
  lock) can lose updates, `withUserLock` makes additive same-user RMW
  converge, writes never produce torn JSON files.

## Windows `fs.rename` EPERM under concurrent writes (mitigated)

On Windows, two concurrent `fs.rename(tmp, dest)` calls against the same
destination can fail with `EPERM` even when both source files exist —
the OS grants exclusive access to the destination during the rename and
rejects the second call. Linux and macOS do not exhibit this because
their `rename(2)` is properly atomic for overwriting an existing file.

**Status:** mitigated. `writeJson` now retries the rename with
exponential backoff (10/20/40/80 ms + jitter, up to 5 attempts) for
the transient codes `EPERM`, `EBUSY`, and `EACCES`. Permanent failures
(e.g. `EROFS`, `ENOSPC`) bypass the retry path and bubble up
immediately. See `tests/storage/json-store.test.ts` for coverage of
both branches.

The retry alone does not solve the lost-update problem above — that
still requires a per-user mutex to fix.
