# Agent Handoff: Next Steps

Date: 2026-04-14

## Purpose

This document is the current handoff note for the next agent.

It records:

- what has already been consolidated
- what still remains
- what order the remaining work should happen in
- what to avoid breaking while continuing the refactor

## Current Baseline

The repo is no longer at the earlier "feature missing" stage.
Several system-level consolidations are already in progress.

### Already Done

- shared CLI screen runtime added at `packages/cli/src/ui/screen.ts`
- low-level in-place redraw continues to live at `packages/cli/src/ui/display.ts`
- framed menu/input helpers now exist:
  - `runMenuLoop`
  - `selectFrame`
  - `confirmFrame`
  - `inputFrame`
  - `passwordFrame`
- several interactive CLI flows were moved onto the shared frame runtime:
  - help, egg, trade, evolutions, leave, connect, events, servers, region
  - nickname input
  - login/register/connect/trade input through prompt wrappers
- shared Pokemon runtime helpers added:
  - `packages/server/src/game/pokemon-state.ts` (`findPokemonByUid`, `getPartyPokemon`)
  - `packages/server/src/game/pokemon-stats.ts`
- typing/stat resolution has started moving onto those shared helpers
- battle transformation coverage was extended and server tests passed earlier in the session
- `game-routes.ts` split into 5 domain route files (trade, egg, evolution, item, storage) — 962 to 295 lines
- `user-routes.ts` integration parsers extracted to `integrations/integration-parsers.ts` — 530 to 363 lines
- `handleFainted` and `doWildAttackAndCheck` separated from Express Response (HTTP/game logic split)
- `TradePokemonCandidate` moved to `shared/types.ts`
- Dead code removed: `clearFormChangeRulesCache`, `prompts.ts` raw functions
- Battle routes request body validation added
- Admin config PUT switched to whitelist
- `json-store` now logs parse errors (vs silent null)
- Polling worker duplicate interval guard
- Trade archive await (was fire-and-forget)
- Confusion self-damage now uses actual pokemon level
- Capture chance division-by-zero guard
- CLI terminal safety: Ctrl+C cursor restore, command execution try-catch, Promise.all error handling
- Tests: 492 to 599 (7 untested game modules covered, battle/shop error cases, edge cases, deterministic egg tests)

### Already Updated Docs

- [docs/terminal-rendering.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/terminal-rendering.md:1)
- [docs/pokemon-mechanics-architecture.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-mechanics-architecture.md:1)
- [docs/pokemon-variant-model.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-variant-model.md:1)
- [docs/pokemon-trade-system.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-trade-system.md:1)

## Highest-Priority Remaining Work

### 1. Split `battle-routes.ts` — DONE

Battle-routes is now 438 lines and acts as a clean orchestrator. Turn logic, battle helpers, and state mutation live in `battle-state.ts`. HTTP parsing/response assembly stays in the route file.

### 2. Finish CLI runtime consolidation — DONE

Events, evolutions, leave, connect, trade, servers, and region screens migrated to the shared screen runtime. Remaining screens (party, storage, inventory, shop, encounter, heal, pokedex) were assessed and are already integrated via `redraw()` — no further migration needed.

### 3. Remove legacy raw prompt debt — DONE

`rawSelect`, `rawInput`, `rawPassword`, `rawConfirm` deleted from `prompts.ts`. Zero callers remained.

## Medium-Priority Remaining Work

### 4. Consolidate held-item and progression rule helpers

Assessed. Files (`held-item-usage.ts`, `growth.ts`, `form-change.ts`, `battle-transformations.ts`) are reasonably well-separated already. No urgent action needed.

### 5. Bring the remaining docs up to the new baseline — DONE

`docs/pokemon-pokeapi-sync-status.md` and `docs/user-journey.md` updated. Stale variant and trade evolution statements fixed.

## Known Cautions

### Do Not Regress The Screen Rule

The user explicitly wants this rule preserved:

- the CLI is a single active frame
- screens should redraw in place
- output should not accumulate like chat logs

Any new interactive work should preserve that rule.

### Do Not Reintroduce Duplicate Pokemon Resolution

Do not add new route-local or feature-local logic for:

- effective typing
- variant resolution
- battle-form override
- stat recomputation

Use the shared state/stat modules instead.

### `connect.ts` Needs Care

[packages/cli/src/commands/connect.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/connect.ts:1) contains mixed/garbled legacy text in some user-facing strings.

It currently builds, but if this file is touched again:

- prefer normalizing its prompt copy while editing
- avoid accidental wide refactors unless the task is specifically connect UX cleanup

## Recommended Order (Current Priorities)

1. `getAllUsers()` scaling (TODO documented, needs index-based lookup)
2. Structured logging (replace `console.log`/`console.error` with proper logger)
3. Rate limiting middleware
4. UserData type splitting (God Object into domain-specific types)

## Verification Checklist

After each chunk:

```bash
npm.cmd run build -w packages/cli
npm.cmd run build -w packages/server
npm.cmd run test -w packages/server
```

If only docs changed, build/test is optional.

## Working Assumptions For The Next Agent

- Do not revert unrelated existing changes.
- `server.log` is just a local run artifact.
- The shared screen runtime and shared Pokemon-state modules are intentional direction, not temporary experiments.
- The next work should continue system consolidation, not add unrelated new features.
