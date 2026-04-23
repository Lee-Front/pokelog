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
produce a partially-written JSON file on disk. However there is **no
per-user mutex** and no compare-and-swap: a concurrent read-modify-write
pair on the same user can silently lose one update:

```
T1: read  (points = 0)
T2: read  (points = 0)
T1: write (points = 100)     // T1 wins
T2: write (points = 200)     // overwrites T1 — 100 is lost
```

This affects any endpoint that mutates the same user's state concurrently:
item usage, party edits, PvP queueing, polling-triggered reward grants,
etc. In practice it is rare because a single user rarely issues two
simultaneous mutations against the same server, but it is a real bug.

**Mitigations (not implemented):**

- Per-user mutex (e.g. `async-mutex` keyed by user id) wrapping every
  `getUser → mutate → saveUser` call.
- Move to a database with transactions.

**Tests:**

- `packages/server/tests/integration/concurrency.test.ts` — pins the
  current behavior: independent users safe, same user can lose updates,
  writes never produce torn JSON files.

## Windows `fs.rename` EPERM under concurrent writes

On Windows, two concurrent `fs.rename(tmp, dest)` calls against the same
destination can fail with `EPERM` even when both source files exist —
the OS grants exclusive access to the destination during the rename and
rejects the second call. This means a burst of concurrent `saveUser`
calls on the same user can occasionally throw on Windows even before
hitting the lost-update problem above. Linux and macOS do not exhibit
this because their `rename(2)` is properly atomic for overwriting an
existing file.

**Mitigation (not implemented):** retry the rename with a short backoff
inside `writeJson`, or wrap under a per-file mutex (same fix as the
lost-update problem).
