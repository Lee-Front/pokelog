# Pokemon Evolution Runtime Gaps

Generated: 2026-04-13

## Purpose

This document lists the evolution branches that are still intentionally unsupported at runtime.

It exists so the project can distinguish:

- branches that are already implemented
- branches that are visible to the player but deferred
- branches that need a future substitute design instead of a literal main-series implementation

## Current Coverage

- Total evolution branches in `data/pokemon/evolution.json`: `477`
- Branches currently marked unsupported by runtime: `0`

The unsupported set is currently limited to unsupported `extra` condition families.

## Unsupported Trigger Family

- none

## Unsupported `extra` Families

- none

## Practical Design Reading

Not all unsupported branches should be implemented literally.

Reasonable future options:

- `min_beauty`
  either add a beauty-like stat or replace it with friendship if the project wants fewer hidden stats
- `needs_overworld_rain`
  add a lightweight weather flag or map it to a region/event substitute
- `turn_upside_down`
  likely needs a project-specific substitute rather than a literal device-orientation mechanic
- `min_damage_taken`
  likely needs battle telemetry or a simpler substitute trigger

## Recommended Next Decisions

1. Decide whether low-frequency one-off conditions should get literal support or curated substitutes.
2. Decide whether beauty, weather, and battle-telemetry substitutes belong in the core progression loop.
3. Decide whether unsupported one-off branches should stay visible as deferred or be hidden until their substitute exists.

