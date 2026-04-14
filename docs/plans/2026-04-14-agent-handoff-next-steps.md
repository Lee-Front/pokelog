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

- shared CLI screen runtime added at [packages/cli/src/ui/screen.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/ui/screen.ts:1)
- low-level in-place redraw continues to live at [packages/cli/src/ui/display.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/ui/display.ts:1)
- framed menu/input helpers now exist:
  - `runMenuLoop`
  - `selectFrame`
  - `confirmFrame`
  - `inputFrame`
  - `passwordFrame`
- several interactive CLI flows were moved onto the shared frame runtime:
  - help
  - egg
  - trade
  - evolutions
  - leave
  - connect
  - nickname input
  - login/register/connect/trade input through prompt wrappers
- shared Pokemon runtime helpers added:
  - [packages/server/src/game/pokemon-state.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-state.ts:1)
  - [packages/server/src/game/pokemon-stats.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-stats.ts:1)
- typing/stat resolution has started moving onto those shared helpers
- battle transformation coverage was extended and server tests passed earlier in the session

### Already Updated Docs

- [docs/terminal-rendering.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/terminal-rendering.md:1)
- [docs/pokemon-mechanics-architecture.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-mechanics-architecture.md:1)
- [docs/pokemon-variant-model.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-variant-model.md:1)
- [docs/pokemon-trade-system.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-trade-system.md:1)

## Highest-Priority Remaining Work

### 1. Split `battle-routes.ts`

This is the biggest remaining system debt.

Target:

- keep HTTP parsing/response assembly in the route file
- move turn logic into shared battle engine modules
- move battle state mutation into shared helpers
- keep type/stat resolution on `pokemon-state.ts` and `pokemon-stats.ts`

Relevant files:

- [packages/server/src/routes/battle-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/battle-routes.ts:1)
- [packages/server/src/game/battle-state.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/battle-state.ts:1)
- [packages/server/src/game/pokemon-state.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-state.ts:1)
- [packages/server/src/game/pokemon-stats.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-stats.ts:1)

Expected outcome:

- route file stops being the de facto battle engine
- battle transformations/weather/form reversion stop living as route-local logic

### 2. Finish CLI runtime consolidation for the old frame-heavy screens

Some older screens already redraw in place, but still manage their own local loops.

Target screens:

- [packages/cli/src/commands/party.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/party.ts:1)
- [packages/cli/src/commands/storage.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/storage.ts:1)
- [packages/cli/src/commands/inventory.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/inventory.ts:1)
- [packages/cli/src/commands/shop.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/shop.ts:1)
- [packages/cli/src/commands/encounter.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/encounter.ts:1)
- [packages/cli/src/commands/events.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/events.ts:1)
- [packages/cli/src/commands/heal.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/heal.ts:1)
- [packages/cli/src/commands/pokedex.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/pokedex.ts:1)

Target:

- reduce command-local `lineCount` / `first` / ad-hoc redraw loops
- move toward one shared screen controller model
- keep the no-accumulation rule enforced by runtime, not by each command

### 3. Remove legacy raw prompt debt after callers are gone

The command layer now mostly goes through the frame runtime, but `ui/prompts.ts` still contains legacy raw prompt implementations.

Relevant file:

- [packages/cli/src/ui/prompts.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/ui/prompts.ts:1)

Target:

- audit remaining direct callers
- remove or minimize `rawSelect`, `rawInput`, `rawPassword`, `rawConfirm`
- keep wrappers only if required for compatibility

This is a cleanup step, not the first refactor target.

## Medium-Priority Remaining Work

### 4. Consolidate held-item and progression rule helpers

The project still has item/evolution/form rule logic spread across multiple files.

Likely consolidation targets:

- held-item condition checks
- equip/unequip rule helpers
- evolution context builder
- shared Pokemon mutation/update pipeline

Relevant files:

- [packages/server/src/game/held-item-usage.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/held-item-usage.ts:1)
- [packages/server/src/game/growth.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/growth.ts:1)
- [packages/server/src/game/form-change.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/form-change.ts:1)
- [packages/server/src/game/battle-transformations.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/battle-transformations.ts:1)

### 5. Bring the remaining docs up to the new baseline

Still likely outdated:

- [docs/pokemon-pokeapi-sync-status.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-pokeapi-sync-status.md:1)
- possibly [docs/user-journey.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/user-journey.md:1) if the CLI flow wording should reflect the shared screen runtime more explicitly

Target:

- remove statements that say variants are only reserved
- remove statements that say interactive trade flow does not exist
- keep system docs aligned with the current shared runtime and shared Pokemon-state direction

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

## Recommended Order

1. Split `battle-routes.ts`
2. Consolidate old frame-heavy CLI screens onto the shared controller model
3. Clean up legacy prompt functions
4. Consolidate held-item/progression rule helpers
5. Update remaining stale docs

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
