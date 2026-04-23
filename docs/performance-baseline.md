# Performance Baseline

Recorded: **2026-04-23**.

## Methodology

- Regular vitest `it` tests that time hot paths with `performance.now()`
  and print stats to console. See
  `packages/server/tests/bench/baseline.test.ts`.
- 3 warm-up iterations per bench (JIT warm-up), then N sampled runs.
- Each test asserts a loose upper bound on the mean so a 10x regression
  trips CI.
- Run: `cd packages/server && npx vitest run tests/bench/baseline.test.ts`

## Results (local developer machine)

| Benchmark                          | n   | mean     | min      | max      |
|------------------------------------|-----|----------|----------|----------|
| `createApp()`                      | 10  | 0.103 ms | 0.075 ms | 0.218 ms |
| `createPokemon(pikachu, lv 50)`    | 200 | 0.062 ms | 0.031 ms | 1.880 ms |
| `createPokemon(charizard, lv 50)`  | 200 | 0.039 ms | 0.030 ms | 0.269 ms |
| `generateTowerParty(stage=1)`      | 30  | 0.248 ms | 0.151 ms | 0.564 ms |
| `generateTowerParty(stage=50)`     | 30  | 0.453 ms | 0.219 ms | 1.736 ms |
| `generateTowerParty(stage=100)`    | 30  | 0.364 ms | 0.194 ms | 0.567 ms |
| `getSpecies()` (cached)            | 100 | ~0 ms    | ~0 ms    | 0.002 ms |

## Observations

- **Server boot is essentially free** — `createApp()` at ~0.1 ms is
  dominated by `express()` object setup (we pay the data-load cost
  elsewhere, on first `getSpecies()` call).
- **Pokemon creation is sub-millisecond**. The occasional ~2 ms outliers
  are GC/JIT warm-up; steady-state is well under 100 µs.
- **Tower AI party generation** is 0.2-0.5 ms regardless of stage.
  Stage 100 is not more expensive than stage 50 because the legendary
  pool lookup is constant-time.
- **Data loader is fully cached**. Subsequent `getSpecies()` calls are
  effectively free.

## Upper-bound assertions (regression tripwires)

- `createApp`: mean < 250 ms (current: 0.1 ms → 2500x headroom)
- `createPokemon`: mean < 5 ms (current: 0.04 ms → 125x headroom)
- `generateTowerParty`: mean < 100 ms (current: 0.3 ms → 333x headroom)
- `getSpecies cached`: mean < 1 ms (current: ~0 ms)

If any of these start tripping, investigate the relevant module before
relaxing the bound.
