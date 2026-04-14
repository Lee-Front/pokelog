# User Journey

## 1. Onboarding

- **Register** -- `POST /api/auth/register` `{ id, password, nickname, starter }`
  - Starter choices: `bulbasaur`, `charmander`, `squirtle` (level 5)
  - Receives 5 Poke Balls, empty pokedex seeded with starter species
  - Returns a JWT token
- **Login** -- `POST /api/auth/login` `{ id, password }`
  - Returns JWT; triggers background integration polling
- **Link identity** -- `POST /api/user/match` `{ app: "git", identifier: "<email>" }`
  - Connects git email so commits are attributed to this account
- **Add integration** -- `POST /api/user/integrations` (git/github/gitlab/notion/jira/slack)
  - Configures repo URL, auth, emails for commit tracking

## 2. Core Loop

- **Earn rewards** -- Server polls repos or integrations detect activity
  - Commit bytes -> EXP + points + combo multiplier
  - Admin test: `POST /api/admin/test/commit` `{ userId, bytes }`
  - Party pokemon gain EXP, may level up and learn new moves
  - Random wild encounter may trigger (ceiling-based probability)
- **Check status** -- `GET /api/game/status`
  - Shows points, totalExp, combo, pendingEventCount, region
- **Check events** -- `GET /api/game/events`
  - Lists active wild encounter events (expire after 168 hours)
- **Battle wild pokemon** -- see Battle Flow below
- **Heal party** -- `POST /api/game/heal`
  - Restores all party pokemon HP to max (free, unlimited)

## 3. Battle Flow

- **Start** -- `POST /api/battle/start` `{ eventId, pokemonUid }`
  - Consumes a pending encounter event, creates battle state
- **Actions** -- `POST /api/battle/action` `{ action, data }`
  - `fight` -- `{ moveId }` -- deal damage, wild retaliates; result: `continue`/`win`/`lose`/`fainted`
  - `catch` -- `{ ball }` -- uses a ball from inventory; result: `continue`/`caught`
  - `item` -- `{ item, pokemonUid? }` -- use a healing item mid-battle
  - `switch` -- `{ pokemonUid }` -- swap active pokemon; wild attacks unless forced
  - `run` -- flee battle, event is consumed
- **Check state** -- `GET /api/battle/state`
- **Win** -- event removed, battle cleared
- **Catch** -- pokemon added to party (or storage if party full), pokedex updated
- **Lose** -- all party fainted, battle cleared

## 4. Progression

- **View party** -- `GET /api/game/party`
- **Pokemon detail** -- `GET /api/game/pokemon/:uid` (includes evolution preview)
- **Reorder party** -- `PUT /api/game/party` `{ uids: [...] }` (max 6)
- **Level up** -- automatic when EXP threshold reached; stats recalculate, new moves learned
- **Evolution** -- automatic on level-up (single branch) or queued as pending (multi-branch)
  - `GET /api/game/evolutions/pending` -- list pending evolution choices
  - `POST /api/game/evolutions/resolve` `{ pendingEvolutionId, branchId }`
- **Buy items** -- `GET /api/shop` then `POST /api/shop/buy` `{ item, quantity }`
  - Balls: pokeball(100), safariball(250), greatball(350), ultraball(900), masterball(50000)
  - Potions: potion(150, +20HP), superPotion(400, +50HP), hyperPotion(800, +120HP)
  - Evolution stones: fire-stone, water-stone, thunder-stone, etc. (3000 each)
  - Held evolution items: metal-coat, kings-rock, dragon-scale, etc. (2000-5000 each)
- **Use items** -- `POST /api/shop/use` `{ item, pokemonUid }`
  - Healing: restores HP by healAmount
  - Evolution: evolves eligible pokemon (e.g. fire-stone on Eevee -> Flareon)
- **Equip held item** -- `POST /api/game/items/equip` `{ item, pokemonUid }`
- **Unequip held item** -- `POST /api/game/items/unequip` `{ pokemonUid }`
- **Check inventory** -- `GET /api/game/inventory`
- **Pokedex** -- `GET /api/game/pokedex` (seen vs caught vs all species)

## 5. Storage and Eggs

- **View storage** -- `GET /api/game/storage`
- **Deposit** -- `POST /api/game/storage/deposit` `{ uid }` (party -> storage, min 1 in party)
- **Withdraw** -- `POST /api/game/storage/withdraw` `{ uid }` (storage -> party, max 6)
- **View eggs** -- `GET /api/game/eggs` (lists tiers: common/120pt, rare/450pt, legend/3200pt)
- **Buy egg** -- `POST /api/game/eggs/buy` `{ tier }`
- **Hatch egg** -- `POST /api/game/eggs/hatch` `{ eggId }` -- random species + level, added to party or storage

## 6. Trading

- **List trade candidates** -- `GET /api/game/trades/candidates/:userId`
- **Create trade** -- `POST /api/game/trades/request` `{ targetUserId, myPokemonUid, targetPokemonUid }`
- **Accept trade** -- `POST /api/game/trades/:id/accept` (pokemon swap, may trigger trade evolution)
- **Reject/Cancel** -- `POST /api/game/trades/:id/reject` or `/cancel`
- **Lock/Unlock** -- `POST /api/game/trades/lock` / `/unlock` `{ pokemonUid }`
- **List trades** -- `GET /api/game/trades`

## 7. Social

- **Ranking** -- `GET /api/social/ranking?by=exp|level|pokedex|points` (public, no auth)
- **Public profile** -- `GET /api/social/profile/:nickname` (public)
- **Search users** -- `GET /api/user/search?q=<query>` (authenticated)
- **Change nickname** -- `PUT /api/user/nickname` `{ nickname }`
- **View profile** -- `GET /api/user/profile`

## 8. Advanced

- **Switch region** -- `GET /api/game/regions` then `PUT /api/game/region` `{ region }`
  - Available: default, kanto, johto, hoenn, sinnoh, unova, kalos, alola, galar, hisui
  - Affects which wild pokemon appear in encounters
- **Regional variants** -- e.g. `vulpix-alola` in alola region encounters
  - Variant pokemon preserve `variantId`, have different typing/stats
- **Trade evolutions** -- equip held item (e.g. metal-coat on Scyther) then trade to trigger evolution
- **Activity history** -- `GET /api/game/history?limit=20` (commit logs, integration rewards)
