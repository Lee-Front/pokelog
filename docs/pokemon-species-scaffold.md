# Pokemon Species Scaffold

Generated: 2026-04-12T06:43:01.764Z

## Summary

- Base species workset size: 905
- Completed species entries already in `data/pokemon/species.json`: 20
- Missing species entries to research and fill: 885
- Species coverage against base art list: 2.21%
- Base species without evolution entry yet: 891
- Species entries with learnset moves missing from `moves.json`: 0

## What This File Is

- `data/pokemon/species-scaffold.json` is a work file, not runtime data.
- Every base species slug from `art-species-split.json` gets one row.
- Existing species data is copied through as-is.
- Missing species get a schema-shaped draft with `null` placeholders so research can be filled in safely.

## Missing Species Preview

- `abomasnow`
- `abra`
- `absol`
- `accelgor`
- `aegislash`
- `aerodactyl`
- `aggron`
- `aipom`
- `alakazam`
- `alcremie`
- `alomomola`
- `altaria`
- `amaura`
- `ambipom`
- `amoonguss`
- `ampharos`
- `anorith`
- `appletun`
- `applin`
- `araquanid`
- `arbok`
- `arcanine`
- `arceus`
- `archen`
- `archeops`
- `arctovish`
- `arctozolt`
- `ariados`
- `armaldo`
- `aromatisse`
- `aron`
- `arrokuda`
- `articuno`
- `audino`
- `aurorus`
- `avalugg`
- `axew`
- `azelf`
- `azumarill`
- `azurill`
- ... and 845 more

## Missing Evolution Entry Preview

- `abomasnow`
- `abra`
- `absol`
- `accelgor`
- `aegislash`
- `aerodactyl`
- `aggron`
- `aipom`
- `alakazam`
- `alcremie`
- `alomomola`
- `altaria`
- `amaura`
- `ambipom`
- `amoonguss`
- `ampharos`
- `anorith`
- `appletun`
- `applin`
- `araquanid`
- ... and 871 more

## Workflow

1. Pick a batch of species from the missing list.
2. Fill the corresponding `draft` objects in `species-scaffold.json`.
3. Add required moves to `data/moves/moves.json`.
4. Add or confirm evolution entries in `data/pokemon/evolution.json`.
5. Once a batch is complete, copy validated entries into runtime `species.json`.

