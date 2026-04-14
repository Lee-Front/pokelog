# Code Review Report

Date: 2026-04-14
Branch: `refactor/codebase-cleanup`

Reviewed the server and gameplay changes described in `docs/code-review-guide.md`. Focus was placed on battle flow, stat stages, evolution and variant handling, and API-side state transitions.

## Findings

[high] `packages/server/src/routes/battle-routes.ts:236` - Wild move selection for turn order can differ from the move actually executed.
- `handleFight()` picks `wildChosenMove` once to compute priority, but the real attack later goes through `doWildAttackAndCheck()` -> `wildAttack()`, which randomly selects again.
- This allows cases where the wild Pokemon wins turn order because of a priority move like `quick-attack`, then actually executes a different move.
- Recommended fix: pass the same selected wild move through execution, or merge move selection and turn-order calculation into a single step.

[high] `packages/server/src/routes/battle-routes.ts:244` - Speed stat stages are stored but never used for turn order.
- `BattleState` now keeps `playerStatStages` and `wildStatStages`, including `speed`, but `determineTurnOrder()` still receives raw `stats.speed`.
- As a result, moves that raise or lower Speed affect damage-side state only and do not change who moves first on later turns.
- Recommended fix: compute effective Speed with `applyStatStageMultiplier()` before calling `determineTurnOrder()`.

[high] `packages/server/src/routes/battle-routes.ts:78` - Stat changes are always applied to the attacker side, so target debuffs are reversed.
- `maybeApplyStatChanges()` updates `playerStatStages` when the player used the move and `wildStatStages` when the wild Pokemon used the move.
- That works only for self-buffs, but data includes target debuffs such as `acid-spray` and `apple-acid`, and mixed behavior such as `ancient-power` and `aqua-step`.
- In the current implementation, a move intended to lower the defender's stat can instead lower the attacker's own stat stages.
- Recommended fix: add an explicit stat-change target such as `self` or `target` to move data and update the correct side based on that field.

[high] `packages/server/src/routes/battle-routes.ts:337` - Capturing a wild Pokemon recreates a new Pokemon instead of preserving the encountered instance.
- Capture currently calls `createPokemon(battle.wild.species, battle.wild.level)`, then only copies current HP.
- This re-rolls nature, gender, ability, shiny status, and drops `variantId`, so the caught Pokemon can differ from the one the player just battled.
- Runtime verification showed a `growlithe-hisui` encounter being converted into a normal `growlithe` with `variantId: null` after capture.
- Recommended fix: add a dedicated `WildPokemon -> OwnedPokemon` conversion path that preserves `variantId`, `nature`, `gender`, `ability`, and current HP.

[high] `packages/server/src/game/pokemon-factory.ts:123` - Variant gameplay overrides are not applied even though variant data now carries real battle fields.
- `resolveSpeciesOrVariant()` only stores `variantId`; stat generation still uses the base species, and battle typing still resolves through `getSpeciesByName(species)?.types`.
- `data/pokemon/variants.json` now contains real overrides such as `typing` and `baseStatsOverride` for regional variants like `growlithe-hisui`, `samurott-hisui`, and `typhlosion-hisui`.
- In practice, the system treats these as cosmetic tags, so encounter, battle, and evolution flows can carry a `variantId` while still using base-species stats and types.
- Recommended fix: centralize variant resolution into an "effective species" layer and apply type, base-stat, and learnset overrides consistently across creation, battle, and evolution paths.

[medium] `packages/server/src/routes/battle-routes.ts:149` - Wild side effects can trigger even when the wild move misses.
- Player-side meta effects and stat changes are guarded by `if (!result.missed)`, but wild-side processing applies `applyMetaEffects()` and `maybeApplyStatChanges()` whenever `wildResult.moveData` exists.
- This can produce impossible outcomes where a missed wild move still heals, applies recoil-style side effects, or changes stat stages.
- Recommended fix: gate wild-side meta and stat effects with the same `missed === false` check used on the player side.

## Verification

- Reviewed the current branch changes against the checklist in `docs/code-review-guide.md`.
- Ran `npm run test -w packages/server`.
- Result: `36` test files passed and `243` tests passed.

## Residual Risk

- Current automated tests do not appear to cover turn-order consistency between chosen and executed wild moves.
- Current automated tests do not appear to cover Speed-stage impact on turn order.
- Current automated tests do not appear to cover correct target application for stat-changing moves.
- Current automated tests do not appear to cover preservation of encountered variant, nature, and ability when a Pokemon is caught.
