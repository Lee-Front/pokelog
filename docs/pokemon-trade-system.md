# Pokemon Trade System

Updated: 2026-04-14

## Purpose

This document describes the current player-to-player trade system.

It records:

- what is already implemented
- how the current interactive CLI works
- how trade-trigger evolutions are resolved
- what is still intentionally missing

## Current Scope

The project now supports:

- explicit trade requests from one user to another
- user search by id or nickname substring
- candidate selection for both sides before creating a request
- responder-side accept or reject
- requester-side cancel
- actual Pokemon exchange between two users
- trade-trigger evolutions during acceptance
- `extra.trade_species` partner requirements during acceptance
- held-item trade evolutions such as `onix -> steelix`
- framed interactive CLI flow for listing and acting on trades

The project still does not support:

- one-way gifts
- multi-offer negotiation
- trade chat or comments
- trade expiration

## Storage Model

Trades are stored centrally in:

- `pokelog-data/trades/trades.json`

Resolved trade history is no longer simply dropped.

Current retention behavior:

- pending trades are retained until resolved
- resolved trades are pruned to the latest 200 active records
- older resolved records are archived to `trades-archive.json`

## Route Surface

Current route flow:

- `GET /api/game/trades`
- `GET /api/game/trades/candidates/:userId`
- `POST /api/game/trades/request`
- `POST /api/game/trades/:id/accept`
- `POST /api/game/trades/:id/reject`
- `POST /api/game/trades/:id/cancel`

## Current CLI Surface

Current CLI commands:

- `pokelog trade`
- `pokelog trade search <query>`
- `pokelog trade request <userId> [myPokemonUid] [theirPokemonUid]`
- `pokelog trade accept <tradeId>`
- `pokelog trade reject <tradeId>`
- `pokelog trade cancel <tradeId>`

Interactive behavior:

- `pokelog trade` opens a framed full-screen trade menu
- pending trades can be selected from the trade list
- action prompts use the shared frame renderer
- new trade requests can resolve target user and Pokemon candidates interactively

## Targeting Rule

Current targeting behavior:

- user search supports partial id or nickname lookup
- if the query resolves to one user, the CLI uses it directly
- if it resolves to multiple users, the CLI asks the player to choose
- if Pokemon uids are omitted, the CLI loads tradeable candidates and asks the player to choose
- if a Pokemon uid is provided, it must still match a currently tradeable candidate

## Candidate Rule

Tradeable candidates currently include:

- party Pokemon
- storage Pokemon

Current exclusions:

- Pokemon currently active in battle

Candidate rows show:

- species name
- nickname
- level
- location
- uid

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

## Trade Evolution Rule

Trade-trigger evolution is a dedicated flow, separate from normal level-up resolution.

Current implementation:

- Pokemon detail diagnostics still mark trade evolution as deferred because another user is required
- actual trade acceptance resolves trade-trigger branches directly

Supported families:

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

Held-item behavior:

- if a trade evolution branch depends on a held item, that item is consumed on evolution

## What Changed From The Older Plan

These older statements are no longer accurate:

- "interactive guided flow does not exist yet"
- "resolved trades are only pruned"
- "trade lock is part of the current system"

Current code already has an interactive framed trade menu, archived resolved trade history, and no trade-lock feature.

## Remaining Gaps

Still missing:

- richer negotiation than single-Pokemon-for-single-Pokemon
- fully unified framed subflows for every deeper trade prompt
- broader integration of trade flow into other full-screen controllers

## Next Work

1. Keep the framed trade flow on top of the shared screen runtime.
2. Fold deeper candidate and action subflows into the same top-level controller structure over time.
3. Extend trade rules only after the current two-sided swap stays stable.
