# Pokemon Species Scaffold

Generated: 2026-04-14T01:01:01.101Z

## Summary

- Base species workset size: 905
- Completed species entries already in `data/pokemon/species.json`: 874
- Missing species entries to research and fill: 31
- Species coverage against base art list: 96.57%
- Base species without evolution entry yet: 0
- Species entries with learnset moves missing from `moves.json`: 0

## What This File Is

- `data/pokemon/species-scaffold.json` is a work file, not runtime data.
- Every base species slug from `art-species-split.json` gets one row.
- Existing species data is copied through as-is.
- Missing species get a schema-shaped draft with `null` placeholders so research can be filled in safely.

## Missing Species Preview

- `aegislash`
- `basculegion`
- `basculin`
- `darmanitan`
- `deoxys`
- `eiscue`
- `enamorus`
- `frillish`
- `giratina`
- `gourgeist`
- `indeedee`
- `jellicent`
- `keldeo`
- `landorus`
- `lycanroc`
- `meloetta`
- `meowstic`
- `mimikyu`
- `minior`
- `morpeko`
- `oricorio`
- `pumpkaboo`
- `pyroar`
- `shaymin`
- `thundurus`
- `tornadus`
- `toxtricity`
- `urshifu`
- `wishiwashi`
- `wormadam`
- `zygarde`

## Missing Evolution Entry Preview

- none

## Workflow

1. Pick a batch of species from the missing list.
2. Fill the corresponding `draft` objects in `species-scaffold.json`.
3. Add required moves to `data/moves/moves.json`.
4. Add or confirm evolution entries in `data/pokemon/evolution.json`.
5. Once a batch is complete, copy validated entries into runtime `species.json`.

