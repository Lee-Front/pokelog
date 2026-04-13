# Pokemon Evolution Schema

Generated: 2026-04-13

## Purpose

This document defines the target evolution schema before runtime implementation is expanded.

The goal is to avoid two problems:

- blocking future evolution conditions because the schema is too narrow
- mixing progression evolution with form change or battle-only transformation

This document follows the boundaries defined in [pokemon-mechanics-architecture.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-mechanics-architecture.md:1).

## Current State

Current implementation status:

- [shared/types.ts](/C:/Users/dlwog/Desktop/project/pokelog/shared/types.ts:313) uses branch-based evolution data
- [packages/server/src/game/growth.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/growth.ts:52) resolves level-up evolution context from owned Pokemon state
- [packages/server/src/game/growth.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/growth.ts:52) currently supports `level`, `item-use`, `friendship`, `held-item`, `time`, `region`, `location` (via region aliasing), `gender`, `known-move`, `known-move-type`, `party-member`, `stat-compare`, `extra.min_affection` and `extra.min_beauty` (via friendship approximation), `extra.used_move` / `extra.min_move_count` through per-Pokemon move usage counters, `extra.min_damage_taken` through cumulative battle damage telemetry, `extra.turn_upside_down` through the curated `topsy-turvy` move substitute, `extra.needs_overworld_rain` through the curated rain-region substitute, and trade branches through the dedicated trade flow
- [packages/server/src/routes/shop-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/shop-routes.ts:1) now applies item-use evolution through the normal item flow
- [packages/server/src/routes/game-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/game-routes.ts:1) now exposes held-item equip and unequip routes
- [packages/server/src/routes/game-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/game-routes.ts:1) now exposes region listing and current-region update routes backed by multiple curated region files
- [packages/server/src/routes/game-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/game-routes.ts:1) now exposes pending evolution listing and branch resolution routes
- [packages/server/src/routes/game-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/game-routes.ts:1) now includes per-branch evolution preview diagnostics in Pokemon detail responses, including progress-aware blocker text for move-usage branches
- [packages/server/src/routes/game-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/game-routes.ts:1) now exposes trade request, accept, reject, cancel, and list routes
- [packages/cli/src/commands/inventory.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/inventory.ts:1) now exposes both evolution items and held items through the interactive inventory UI
- [packages/cli/src/commands/evolutions.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/evolutions.ts:1) now resolves pending branch choices from the CLI
- [packages/cli/src/commands/trade.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/trade.ts:1) now exposes first-pass trade list and request/accept/reject/cancel commands
- [packages/cli/src/commands/status.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/status.ts:1) now surfaces pending evolution count and can open the resolution flow directly from the status screen
- [packages/cli/src/commands/party.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/party.ts:1) now marks party members with pending evolutions and resolves them directly from the party screen
- [packages/cli/src/commands/pokemon.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/pokemon.ts:1) now exposes both a direct resolve action and per-branch evolution diagnostics from the individual Pokemon detail screen
- [packages/cli/src/commands/storage.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/cli/src/commands/storage.ts:1) now marks pending evolutions in both party and storage columns and resolves them directly with `E`
- [packages/server/src/game/pokemon-factory.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-factory.ts:1) now assigns owned Pokemon gender from species gender rate data
- [packages/server/src/routes/battle-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/battle-routes.ts:1) now records player move usage counts on owned Pokemon during battle
- [packages/server/src/routes/battle-routes.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/routes/battle-routes.ts:1) now also records cumulative damage taken on owned Pokemon during battle
- [data/pokemon/evolution.json](/C:/Users/dlwog/Desktop/project/pokelog/data/pokemon/evolution.json:1) is already stored in branch form

The remaining gap is not schema shape anymore. It is the unsupported condition families and the project-specific substitutes for them.

## Design Rules

Evolution in this project must follow these rules:

1. Evolution is progression, not form change.
2. A species can have zero, one, or many branches.
3. A branch may target either a base species or a permanent variant.
4. Conditions must be composable.
5. The first milestone only implements a subset of conditions, but the schema must support more.

## Recommended Type Direction

```ts
type EvolutionCondition =
  | { type: "level"; level: number }
  | { type: "item-use"; item: string }
  | { type: "friendship"; min: number }
  | { type: "trade" }
  | { type: "held-item"; item: string }
  | { type: "time"; value: "day" | "night" | "dusk" }
  | { type: "region"; region: string }
  | { type: "gender"; value: "male" | "female" }
  | { type: "known-move"; moveId: string }
  | { type: "stat-compare"; stat: "attack-vs-defense"; op: "gt" | "eq" | "lt" }
  | { type: "party-member"; species?: string; type?: string };

interface EvolutionBranch {
  id: string;
  targetSpecies: string;
  targetVariantId?: string;
  conditions: EvolutionCondition[];
  consumeItem?: string | null;
}

interface SpeciesEvolutionData {
  branches: EvolutionBranch[];
}
```

## Why Branches Instead of `evolvesTo`

Single-target evolution breaks as soon as the project hits:

- Eevee-style branching
- Item versus friendship split evolutions
- Variant-only evolution targets
- Future regional evolution targets

Branches solve this without changing the runtime meaning of basic evolutions.

## Condition Semantics

### `level`

The Pokemon must be at least this level.

Example:

```json
{ "type": "level", "level": 16 }
```

### `item-use`

Evolution only happens when the user explicitly uses an item.

Example:

```json
{ "type": "item-use", "item": "thunder-stone" }
```

### `friendship`

Used for happiness-based evolution later.

Example:

```json
{ "type": "friendship", "min": 220 }
```

### `trade`

Used for trade-only evolutions later.

Example:

```json
{ "type": "trade" }
```

### `held-item`

Used when the Pokemon must hold a specific item while evolving or trading.

Example:

```json
{ "type": "held-item", "item": "metal-coat" }
```

### `time`

Used for day/night or future time-window evolution.

Example:

```json
{ "type": "time", "value": "night" }
```

### `region`

Used when evolution depends on the active region or a future location model.

Example:

```json
{ "type": "region", "region": "hisui" }
```

### `gender`

Used when only male or female Pokemon can evolve this way.

Example:

```json
{ "type": "gender", "value": "female" }
```

### `known-move`

Used when a move must already be known.

Example:

```json
{ "type": "known-move", "moveId": "rollout" }
```

### `stat-compare`

Used for Tyrogue-style comparisons later.

Example:

```json
{ "type": "stat-compare", "stat": "attack-vs-defense", "op": "gt" }
```

### `party-member`

Used when a specific party requirement exists.

Example:

```json
{ "type": "party-member", "type": "dark" }
```

## First Implementation Scope

The current runtime milestone supports:

- `level`
- `item-use`
- `friendship`
- `held-item`
- `time`
- `region`
- `location` via region aliasing
- `gender`
- `known-move`
- `known-move-type`
- `party-member`
- `stat-compare`
- `extra.min_affection` via friendship approximation
- `extra.min_beauty` via friendship approximation
- `extra.used_move`
- `extra.min_move_count`
- `extra.min_damage_taken`
- `extra.turn_upside_down` via the curated `topsy-turvy` requirement
- `extra.needs_overworld_rain` via the curated rain-region substitute
- trade through the dedicated user-to-user exchange flow
- `extra.trade_species` when the trade partner species is known

These conditions currently cover:

- starter-line evolutions
- stone evolutions such as Pikachu
- friendship evolutions such as Pichu or Riolu
- move-based evolutions such as Aipom or Yanma
- party/stat comparison evolutions such as Pancham or Tyrogue
- location-family evolutions such as Magneton or Charjabug, using the current region model as the nearest runtime substitute
- Sylveon-style affection checks, using friendship as the current nearest runtime substitute
- Feebas beauty checks, using friendship as the current nearest runtime substitute
- move-usage evolutions such as Primeape or Stantler, using per-Pokemon move usage counters recorded from battle actions
- damage-taken evolutions such as Basculin or Yamask, using per-Pokemon cumulative damage tracked from battle actions
- Inkay's upside-down evolution, using `topsy-turvy` knowledge as the current project substitute
- Sliggoo's rain evolution, using a curated rain-region substitute in the current region model
- trade evolutions such as Kadabra, Onix, Karrablast, or Shelmet, using the current player-to-player trade flow

The schema still reserves all other condition types for later.

## Deferred Runtime Scope

These are still deferred at runtime:

- literal main-series beauty, overworld rain, and device-orientation mechanics
- any future PokeAPI `extra` families outside the currently curated substitutes

Current deferred inventory:

- `0` unsupported runtime branches

Reference:

- [docs/pokemon-evolution-runtime-gaps.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-evolution-runtime-gaps.md:1)
- [docs/pokemon-trade-system.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-trade-system.md:1)

## Branch Evaluation Rule

Runtime currently evaluates evolution branches like this:

1. Collect all branches for the current species.
2. Filter branches whose conditions are all satisfied.
3. If zero branches match, do nothing.
4. If one branch matches, evolve directly.
5. If multiple branches match, create a pending evolution entry and require explicit user choice.

Branches whose trigger or condition family is still unsupported are excluded from auto-resolution and reported as deferred in Pokemon detail diagnostics.

This prevents bad automatic resolution for branching species and keeps the actual choice out of the reward-processing path.

## Item Consumption Rule

Only `item-use` branches should consume an item.

Recommended rule:

- `consumeItem` defaults to the same item named in `item-use`
- if omitted, runtime may infer consumption from the `item-use` condition

This keeps the data explicit without forcing duplication everywhere.

## Variant Target Rule

Evolution may target:

- `targetSpecies` only
- `targetSpecies + targetVariantId`

Use `targetVariantId` only when the evolution result is not the default base form.

Do not use this for battle-only transformations.

## JSON Shape Recommendation

Recommended future JSON:

```json
{
  "bulbasaur": {
    "branches": [
      {
        "id": "bulbasaur-level-16",
        "targetSpecies": "ivysaur",
        "conditions": [
          { "type": "level", "level": 16 }
        ]
      }
    ]
  },
  "pikachu": {
    "branches": [
      {
        "id": "pikachu-thunder-stone",
        "targetSpecies": "raichu",
        "conditions": [
          { "type": "item-use", "item": "thunder-stone" }
        ],
        "consumeItem": "thunder-stone"
      }
    ]
  }
}
```

## Migration From Current File

Current shape:

```json
{
  "charmander": {
    "evolvesTo": "charmeleon",
    "condition": { "type": "level", "level": 16 }
  }
}
```

Migration rule:

- `evolvesTo` becomes `targetSpecies`
- `condition` becomes a one-element `conditions` array
- missing or null evolution becomes `branches: []`

Example migration:

```json
{
  "charmander": {
    "branches": [
      {
        "id": "charmander-level-16",
        "targetSpecies": "charmeleon",
        "conditions": [
          { "type": "level", "level": 16 }
        ]
      }
    ]
  }
}
```

## Runtime Boundaries

Keep these out of the evolution system:

- Castform weather form change
- Aegislash stance change
- Rotom appliance swaps
- Mega Evolution
- Gigantamax
- Terastalization
- Transform move copying

Those are separate systems even if they change appearance, typing, or stats.

## Implementation Sequence

1. Keep branch-based evolution data as the canonical format.
2. Keep migration support so old and new `evolution.json` shapes can both be read.
3. Maintain runtime handling for `level`, `item-use`, and the currently active level-up context conditions.
4. Keep the item inventory flow and held-item equipment flow aligned with evolution conditions.
5. Maintain the pending evolution flow for multiple valid branches.
6. Add the remaining condition families later.

## Project Decision Summary

- The project will use branch-based evolution data.
- The current runtime milestone supports `level`, `item-use`, `friendship`, `held-item`, `time`, `gender`, `known-move`, `known-move-type`, `party-member`, and `stat-compare`.
- The current runtime milestone also supports `location` through region aliasing, `extra.min_affection` / `extra.min_beauty` through friendship approximation, `extra.used_move` / `extra.min_move_count` through per-Pokemon move usage counters, `extra.min_damage_taken` through cumulative battle damage telemetry, `extra.turn_upside_down` through the curated `topsy-turvy` substitute, `extra.needs_overworld_rain` through the curated rain-region substitute, and `trade` / `extra.trade_species` through the dedicated trade flow.
- Item-use and held-item evolution prerequisites are now reachable through the inventory/equipment flow.
- Owned Pokemon gender is now generated from synced species gender-rate data and persisted for evolution checks.
- Owned Pokemon now persist move usage counters and cumulative damage taken so battle actions can unlock both move-usage and damage-threshold evolutions on later level checks.
- Trade requests are now a first-pass multiplayer system backed by a central trade store, and accepting a trade can trigger trade evolutions immediately.
- Region conditions now evaluate against each user's persisted `currentRegion` instead of a hardcoded default context, and the repo now ships multiple named region pools instead of `default` only.
- Region conditions now evaluate against each user's persisted `currentRegion` instead of a hardcoded default context, and those region pools are now normalized by the loader before encounter/evolution context is used at runtime.
- Multiple valid branches no longer auto-resolve; they are stored as pending evolutions until the user chooses a branch, and the interactive status, party, Pokemon detail, and storage flows now link directly into that resolution step.
- Trade-trigger branches are no longer part of normal level-up auto-resolution. They now resolve through the dedicated trade flow, while Pokemon detail continues to show them as deferred requirements, with progress-aware blocker text for tracked move-usage evolutions.
- Form change and battle-only transformations are not part of evolution.
- Tera, Gigantamax, and Mega Evolution are explicitly deferred.
