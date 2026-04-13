# Pokemon Trade System

Generated: 2026-04-13

## Purpose

This document describes the current first-pass player-to-player trade system.

It records what is already implemented, how trade-trigger evolutions are resolved, and what is still intentionally missing.

## Current Scope

The project now supports:

- explicit trade requests from one user to another
- user search by id or nickname substring before making a request
- trade candidate listing for both sides before confirming a request
- per-Pokemon trade lock flags
- responder-side accept or reject
- requester-side cancel
- actual Pokemon exchange between two user accounts
- trade-trigger evolutions during acceptance
- `trade_species` partner requirements during acceptance
- held-item trade evolutions such as `onix -> steelix`

The project does not yet support:

- one-way gifts
- negotiation with multiple offered Pokemon
- trade chat or comments
- trade expiration

## Storage Model

Trades are stored centrally in:

- `pokelog-data/trades/trades.json`

Each record contains:

- requester user id
- requester Pokemon uid
- responder user id
- responder Pokemon uid
- status
- timestamps

This keeps trade state out of individual user files and avoids duplicated pending state.

Retention rule:

- pending trades are always retained until resolved
- resolved trades are automatically pruned to the most recent 200 records
- pruning happens when the central trade store is saved

## Request Flow

Current route flow:

- `GET /api/game/trades`
- `GET /api/game/trades/candidates/:userId`
- `POST /api/game/trades/request`
- `POST /api/game/trades/:id/accept`
- `POST /api/game/trades/:id/reject`
- `POST /api/game/trades/:id/cancel`
- `POST /api/game/trades/lock`
- `POST /api/game/trades/unlock`

Current CLI flow:

- `pokelog trade`
- `pokelog trade search <query>`
- `pokelog trade request <userId> [myPokemonUid] [theirPokemonUid]`
- `pokelog trade accept <tradeId>`
- `pokelog trade reject <tradeId>`
- `pokelog trade cancel <tradeId>`
- `pokelog trade lock <pokemonUid>`
- `pokelog trade unlock <pokemonUid>`

Current targeting rule:

- the CLI can now search by partial id or nickname
- `trade request` resolves the first argument through user search
- if Pokemon uids are omitted, the CLI loads both users' tradeable candidates and asks the user to choose
- if a Pokemon uid is provided, it must still match a currently tradeable candidate

Tradeable candidate rule:

- party and storage Pokemon are both eligible
- a Pokemon currently active in battle is excluded from candidate lists
- a Pokemon marked `tradeLocked` is excluded from candidate lists
- candidate rows show species name, nickname, level, location, and uid

Trade lock rule:

- each owned Pokemon now carries a `tradeLocked` flag
- newly created Pokemon default to unlocked
- legacy user data is normalized to unlocked on load
- locked Pokemon are rejected both at candidate-list time and at actual request validation time
- Pokemon detail, party, and storage views now surface trade lock state in the CLI
- Pokemon detail can toggle the flag directly, and party/storage screens now expose the same toggle on `L`

## Exchange Rule

When a trade is accepted:

1. The server verifies both users still exist.
2. The server verifies both Pokemon are still owned by the expected users.
3. The server blocks trading a Pokemon that is currently active in battle.
4. The two Pokemon are removed from their current owners.
5. The received Pokemon is inserted back into the same slot type.

Current slot behavior:

- if the traded Pokemon came from party, the received Pokemon goes into party at the same position
- if the traded Pokemon came from storage, the received Pokemon goes into storage

This preserves party size and avoids dropping received Pokemon into the wrong collection automatically.

## Trade Evolution Rule

Trade-trigger evolution is now a dedicated flow, separate from normal level-up checks.

Current implementation:

- normal Pokemon detail diagnostics mark trade evolution as deferred because it needs another user
- actual trade acceptance resolves trade-trigger branches directly

Supported trade evolution families:

- plain trade
- trade + held item
- trade + `extra.trade_species`

Examples already covered:

- `kadabra -> alakazam`
- `machoke -> machamp`
- `onix -> steelix`
- `scyther -> scizor`
- `karrablast -> escavalier` when traded with `shelmet`
- `shelmet -> accelgor` when traded with `karrablast`

Held item behavior:

- if a trade evolution branch depends on `held-item`, the held item is consumed on evolution

## Current Limitations

- The system currently assumes a two-Pokemon swap only.
- Trade-trigger branches are supported in the trade flow, but not surfaced as an interactive guided flow inside the full-screen UI yet.

## Recommended Next Work

1. Decide whether old resolved trade records should be archived elsewhere before pruning.
2. Add a richer interactive trade flow instead of command-first trade management only.
3. Decide whether users should be allowed to request trades against party-only, storage-only, or opt-in marked Pokemon only.
