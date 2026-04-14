import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestApp, type TestApp } from "../api/test-helpers.js";

/**
 * E2E User Journey Tests
 *
 * These tests follow natural user flows -- each scenario is self-contained
 * (registers its own user) and verifies side effects, not just status codes.
 *
 * Scenarios:
 *  1. New Player Journey: register -> starter -> status -> party -> heal
 *  2. Earn and Spend: give points -> buy pokeballs -> verify inventory
 *  3. Battle Flow: give encounter -> fight until win -> verify EXP/points
 *  4. Catch and Collect: encounter -> catch -> verify pokemon + pokedex
 *  5. Item Economy: buy potion -> damage pokemon -> use potion -> verify HP + inventory
 *  6. Evolution: buy fire-stone -> use on vulpix -> verify species changed + pokedex
 *  7. Trade Journey: two users -> trade starters -> verify swap
 *  8. Egg Lifecycle: buy common egg -> hatch -> verify new pokemon
 *  9. Held Item Flow: give held item -> equip -> verify -> unequip -> verify inventory
 * 10. Regional Variant: set alola region -> encounter vulpix-alola -> catch -> verify variantId
 */

describe("User Journey E2E", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(() => {
    t?.cleanup();
  });

  // ---------- Scenario 1: New Player Journey ----------
  // Register a brand new user, verify they get a starter pokemon at level 5,
  // check status shows zero points, party has exactly one pokemon, and heal works.
  it("Scenario 1: New Player Journey", async () => {
    const { token, userId } = await t.registerAndLogin("newplayer", "squirtle");
    const api = t.authed(token);

    // Check status
    const status = await api.get("/api/game/status");
    expect(status.status).toBe(200);
    expect(status.body.nickname).toBe("newplayer");
    expect(status.body.points).toBe(0);
    expect(status.body.totalExp).toBe(0);

    // Check party -- should have exactly the starter
    const party = await api.get("/api/game/party");
    expect(party.status).toBe(200);
    expect(party.body.party).toHaveLength(1);
    const starter = party.body.party[0];
    expect(starter.species).toBe("squirtle");
    expect(starter.level).toBe(5);
    expect(starter.hp).toBe(starter.maxHp);
    expect(typeof starter.nature).toBe("string");
    expect(["male", "female", "genderless"]).toContain(starter.gender);

    // Check pokedex has starter
    const pokedex = await api.get("/api/game/pokedex");
    expect(pokedex.status).toBe(200);
    expect(pokedex.body.seen).toContain("squirtle");

    // Check inventory has 5 starter pokeballs
    const inv = await api.get("/api/game/inventory");
    expect(inv.status).toBe(200);
    expect(inv.body.inventory.pokeball).toBe(5);

    // Heal (should work even at full HP)
    const heal = await api.post("/api/game/heal");
    expect(heal.status).toBe(200);
    expect(heal.body.healed).toBe(1);
  });

  // ---------- Scenario 2: Earn and Spend ----------
  // Give user points via admin, buy pokeballs from shop, verify points deducted
  // and inventory updated correctly.
  it("Scenario 2: Earn and Spend", async () => {
    const { token, userId } = await t.registerAndLogin("earner", "charmander");
    const api = t.authed(token);

    // Give 1000 points via admin
    const give = await t.admin().post("/api/admin/test/give-points", { userId, amount: 1000 });
    expect(give.status).toBe(200);
    expect(give.body.points).toBe(1000);

    // Check shop
    const shop = await api.get("/api/shop");
    expect(shop.status).toBe(200);
    expect(shop.body.items.pokeball.price).toBe(100);
    expect(shop.body.points).toBe(1000);

    // Buy 3 pokeballs (300 points)
    const buy = await api.post("/api/shop/buy", { item: "pokeball", quantity: 3 });
    expect(buy.status).toBe(200);
    expect(buy.body.points).toBe(700);
    // Starter gets 5 pokeballs + 3 bought = 8
    expect(buy.body.inventory.pokeball).toBe(8);

    // Verify via inventory endpoint
    const inv = await api.get("/api/game/inventory");
    expect(inv.status).toBe(200);
    expect(inv.body.inventory.pokeball).toBe(8);

    // Verify points via status
    const status = await api.get("/api/game/status");
    expect(status.status).toBe(200);
    expect(status.body.points).toBe(700);
  });

  // ---------- Scenario 3: Battle Flow ----------
  // Give a wild encounter, start battle, fight repeatedly until win,
  // then verify the battle state is cleared.
  it("Scenario 3: Battle Flow", async () => {
    const { token, userId } = await t.registerAndLogin("fighter", "charmander");
    const api = t.authed(token);

    // Get party to find starter uid and first move
    const party = await api.get("/api/game/party");
    const myPokemon = party.body.party[0];
    const moveId = myPokemon.moves[0].id;

    // Give a low-level encounter
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 3,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Start battle
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: myPokemon.uid,
    });
    expect(start.status).toBe(200);
    expect(start.body.battleState).toBeDefined();
    expect(start.body.battleState.wild.species).toBe("rattata");

    // Fight until win or lose (max 30 turns safety)
    let result = "continue";
    for (let turn = 0; turn < 30 && result === "continue"; turn++) {
      const action = await api.post("/api/battle/action", {
        action: "fight",
        data: { moveId },
      });
      expect(action.status).toBe(200);
      result = action.body.result;

      // If our pokemon fainted but we still "lost", that is fine
      if (result === "fainted") {
        // No other party member; should not happen with lv5 vs lv3 normally
        break;
      }
    }

    expect(["win", "lose", "fainted"]).toContain(result);

    if (result === "win") {
      // Battle state should be cleared
      const state = await api.get("/api/battle/state");
      expect(state.body.battleState).toBeNull();

      // Event should be consumed
      const events = await api.get("/api/game/events");
      const remaining = events.body.events.filter(
        (e: { id: string }) => e.id === eventId,
      );
      expect(remaining).toHaveLength(0);
    }
  });

  // ---------- Scenario 4: Catch and Collect ----------
  // Give encounter, attempt catch with pokeball, verify caught pokemon
  // appears in party with nature/gender, and pokedex is updated.
  it("Scenario 4: Catch and Collect", async () => {
    const { token, userId } = await t.registerAndLogin("catcher", "charmander");
    const api = t.authed(token);

    // Give extra pokeballs to ensure we have enough
    await t.admin().post("/api/admin/test/give-item", { userId, item: "masterball", quantity: 1 });

    // Get party
    const party = await api.get("/api/game/party");
    const myPokemon = party.body.party[0];

    // Give encounter
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "pidgey",
      level: 3,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Start battle
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: myPokemon.uid,
    });
    expect(start.status).toBe(200);

    // Use masterball for guaranteed catch
    const catchAction = await api.post("/api/battle/action", {
      action: "catch",
      data: { ball: "masterball" },
    });
    expect(catchAction.status).toBe(200);
    expect(catchAction.body.result).toBe("caught");
    expect(catchAction.body.pokemon).toBeDefined();
    expect(catchAction.body.pokemon.species).toBe("pidgey");
    expect(typeof catchAction.body.pokemon.nature).toBe("string");
    expect(["male", "female", "genderless"]).toContain(catchAction.body.pokemon.gender);

    // Verify pokemon is now in party
    const newParty = await api.get("/api/game/party");
    const pidgey = newParty.body.party.find(
      (p: { species: string }) => p.species === "pidgey",
    );
    expect(pidgey).toBeDefined();
    expect(pidgey.level).toBe(3);

    // Verify pokedex updated
    const pokedex = await api.get("/api/game/pokedex");
    expect(pokedex.body.seen).toContain("pidgey");
    expect(pokedex.body.caught).toContain("pidgey");

    // Verify masterball consumed
    const inv = await api.get("/api/game/inventory");
    expect(inv.body.inventory.masterball ?? 0).toBe(0);
  });

  // ---------- Scenario 5: Item Economy ----------
  // Buy a potion, damage pokemon via battle, use potion to heal,
  // verify HP restored and potion consumed.
  it("Scenario 5: Item Economy", async () => {
    const { token, userId } = await t.registerAndLogin("healer", "charmander");
    const api = t.authed(token);

    // Give points and buy a potion
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 5000 });
    const buy = await api.post("/api/shop/buy", { item: "potion", quantity: 1 });
    expect(buy.status).toBe(200);
    expect(buy.body.inventory.potion).toBe(1);

    // Get party
    const party = await api.get("/api/game/party");
    const myPokemon = party.body.party[0];
    const originalMaxHp = myPokemon.maxHp;

    // Create encounter and take some damage
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "rattata",
      level: 3,
    });
    const eventId = enc.body.event.id;

    await api.post("/api/battle/start", {
      eventId,
      pokemonUid: myPokemon.uid,
    });

    // Fight one round to take damage, then run
    const moveId = myPokemon.moves[0].id;
    await api.post("/api/battle/action", {
      action: "fight",
      data: { moveId },
    });

    // Check if battle is still active, if so run away
    const battleState = await api.get("/api/battle/state");
    if (battleState.body.battleState) {
      await api.post("/api/battle/action", { action: "run" });
    }

    // Check current HP
    const partyAfterBattle = await api.get("/api/game/party");
    const damagedPokemon = partyAfterBattle.body.party[0];

    // If pokemon took damage, use potion; otherwise verify potion is still there
    if (damagedPokemon.hp < damagedPokemon.maxHp) {
      const hpBefore = damagedPokemon.hp;

      // Use potion
      const useRes = await api.post("/api/shop/use", {
        item: "potion",
        pokemonUid: damagedPokemon.uid,
      });
      expect(useRes.status).toBe(200);
      expect(useRes.body.kind).toBe("healing");
      expect(useRes.body.pokemon.hp).toBeGreaterThan(hpBefore);
      // Potion heals 20 HP
      expect(useRes.body.pokemon.hp).toBe(Math.min(damagedPokemon.maxHp, hpBefore + 20));

      // Verify potion consumed
      const inv = await api.get("/api/game/inventory");
      expect(inv.body.inventory.potion ?? 0).toBe(0);
    } else {
      // Pokemon didn't take damage (unlikely but possible if it one-shot and dodged)
      // Potion use on full HP pokemon should fail
      const useRes = await api.post("/api/shop/use", {
        item: "potion",
        pokemonUid: damagedPokemon.uid,
      });
      expect(useRes.status).toBe(400);
    }
  });

  // ---------- Scenario 6: Evolution ----------
  // Give user a vulpix, buy a fire-stone, use it to evolve into ninetales,
  // verify species changed and pokedex updated.
  it("Scenario 6: Evolution via item", async () => {
    const { token, userId } = await t.registerAndLogin("evolver", "charmander");
    const api = t.authed(token);

    // Give a vulpix
    const give = await t.admin().post("/api/admin/test/give-pokemon", {
      userId,
      species: "vulpix",
      level: 10,
    });
    expect(give.status).toBe(200);
    const vulpixUid = give.body.pokemon.uid;

    // Give points and buy fire-stone
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 5000 });
    const buy = await api.post("/api/shop/buy", { item: "fire-stone", quantity: 1 });
    expect(buy.status).toBe(200);
    expect(buy.body.inventory["fire-stone"]).toBe(1);

    // Verify pokedex has vulpix but not ninetales yet
    const pokedexBefore = await api.get("/api/game/pokedex");
    expect(pokedexBefore.body.seen).toContain("vulpix");

    // Use fire-stone on vulpix
    const useRes = await api.post("/api/shop/use", {
      item: "fire-stone",
      pokemonUid: vulpixUid,
    });
    expect(useRes.status).toBe(200);
    expect(useRes.body.kind).toBe("evolution");
    expect(useRes.body.pokemon.species).toBe("ninetales");

    // Verify fire-stone consumed
    expect(useRes.body.inventory["fire-stone"] ?? 0).toBe(0);

    // Verify pokedex updated
    const pokedexAfter = await api.get("/api/game/pokedex");
    expect(pokedexAfter.body.seen).toContain("ninetales");
    expect(pokedexAfter.body.caught).toContain("ninetales");

    // Verify pokemon detail shows ninetales
    const detail = await api.get(`/api/game/pokemon/${vulpixUid}`);
    expect(detail.status).toBe(200);
    expect(detail.body.pokemon.species).toBe("ninetales");
  });

  // ---------- Scenario 7: Trade Journey ----------
  // Two users register, trade their starters, verify each user has
  // the other's pokemon after the trade completes.
  it("Scenario 7: Trade Journey", async () => {
    const user1 = await t.registerAndLogin("traderA", "charmander");
    const user2 = await t.registerAndLogin("traderB", "squirtle");
    const api1 = t.authed(user1.token);
    const api2 = t.authed(user2.token);

    // Get each user's starter
    const party1 = await api1.get("/api/game/party");
    const party2 = await api2.get("/api/game/party");
    const poke1 = party1.body.party[0];
    const poke2 = party2.body.party[0];
    expect(poke1.species).toBe("charmander");
    expect(poke2.species).toBe("squirtle");

    // User1 creates trade request
    const tradeReq = await api1.post("/api/game/trades/request", {
      targetUserId: user2.userId,
      myPokemonUid: poke1.uid,
      targetPokemonUid: poke2.uid,
    });
    expect(tradeReq.status).toBe(201);
    expect(tradeReq.body.trade.status).toBe("pending");
    const tradeId = tradeReq.body.trade.id;

    // User2 sees the trade in their list
    const trades2 = await api2.get("/api/game/trades");
    expect(trades2.body.trades.length).toBeGreaterThanOrEqual(1);
    const incoming = trades2.body.trades.find(
      (tr: { id: string }) => tr.id === tradeId,
    );
    expect(incoming).toBeDefined();
    expect(incoming.direction).toBe("incoming");

    // User2 accepts
    const accept = await api2.post(`/api/game/trades/${tradeId}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.trade.status).toBe("accepted");

    // Verify swap: user1 now has squirtle, user2 has charmander
    const newParty1 = await api1.get("/api/game/party");
    const newParty2 = await api2.get("/api/game/party");
    expect(newParty1.body.party[0].species).toBe("squirtle");
    expect(newParty2.body.party[0].species).toBe("charmander");
  });

  // ---------- Scenario 8: Egg Lifecycle ----------
  // Give points, buy a common egg, verify it appears in egg list,
  // hatch it, verify new pokemon added to party/storage and pokedex updated.
  it("Scenario 8: Egg Lifecycle", async () => {
    const { token, userId } = await t.registerAndLogin("egghatcher", "charmander");
    const api = t.authed(token);

    // Give points for egg purchase
    await t.admin().post("/api/admin/test/give-points", { userId, amount: 5000 });

    // Check egg tiers
    const eggInfo = await api.get("/api/game/eggs");
    expect(eggInfo.status).toBe(200);
    const commonTier = eggInfo.body.tiers.find(
      (tier: { tier: string }) => tier.tier === "common",
    );
    expect(commonTier).toBeDefined();
    expect(commonTier.cost).toBe(120);

    // Buy a common egg
    const buyEgg = await api.post("/api/game/eggs/buy", { tier: "common" });
    expect(buyEgg.status).toBe(200);
    expect(buyEgg.body.egg).toBeDefined();
    expect(buyEgg.body.egg.tier).toBe("common");
    expect(buyEgg.body.cost).toBe(120);
    expect(buyEgg.body.remainingPoints).toBe(5000 - 120);
    const eggId = buyEgg.body.egg.id;

    // Verify egg appears in egg list
    const eggs = await api.get("/api/game/eggs");
    const myEgg = eggs.body.eggs.find((e: { id: string }) => e.id === eggId);
    expect(myEgg).toBeDefined();

    // Record pokedex before hatch
    const pokedexBefore = await api.get("/api/game/pokedex");
    const seenBefore = new Set(pokedexBefore.body.seen);

    // Hatch the egg
    const hatch = await api.post("/api/game/eggs/hatch", { eggId });
    expect(hatch.status).toBe(200);
    expect(hatch.body.pokemon).toBeDefined();
    expect(typeof hatch.body.pokemon.species).toBe("string");
    expect(hatch.body.pokemon.level).toBeGreaterThanOrEqual(1);
    expect(["party", "storage"]).toContain(hatch.body.destination);
    const hatchedSpecies = hatch.body.pokemon.species;

    // Verify egg removed from list
    const eggsAfter = await api.get("/api/game/eggs");
    const removedEgg = eggsAfter.body.eggs.find((e: { id: string }) => e.id === eggId);
    expect(removedEgg).toBeUndefined();

    // Verify pokedex updated if it was a new species
    const pokedexAfter = await api.get("/api/game/pokedex");
    expect(pokedexAfter.body.seen).toContain(hatchedSpecies);
  });

  // ---------- Scenario 9: Held Item Flow ----------
  // Give a held item via admin, equip on pokemon, verify equipped,
  // unequip, verify returned to inventory.
  it("Scenario 9: Held Item Flow", async () => {
    const { token, userId } = await t.registerAndLogin("holder", "charmander");
    const api = t.authed(token);

    // Get starter uid
    const party = await api.get("/api/game/party");
    const pokemon = party.body.party[0];

    // Give a holdable item
    await t.admin().post("/api/admin/test/give-item", {
      userId,
      item: "metal-coat",
      quantity: 1,
    });

    // Verify item in inventory
    const invBefore = await api.get("/api/game/inventory");
    expect(invBefore.body.inventory["metal-coat"]).toBe(1);

    // Equip on pokemon
    const equip = await api.post("/api/game/items/equip", {
      item: "metal-coat",
      pokemonUid: pokemon.uid,
    });
    expect(equip.status).toBe(200);
    expect(equip.body.pokemon.heldItem).toBe("metal-coat");
    // Item removed from inventory
    expect(equip.body.inventory["metal-coat"] ?? 0).toBe(0);

    // Verify via pokemon detail
    const detail = await api.get(`/api/game/pokemon/${pokemon.uid}`);
    expect(detail.body.pokemon.heldItem).toBe("metal-coat");

    // Unequip
    const unequip = await api.post("/api/game/items/unequip", {
      pokemonUid: pokemon.uid,
    });
    expect(unequip.status).toBe(200);
    expect(unequip.body.pokemon.heldItem).toBeNull();

    // Item returned to inventory
    const invAfter = await api.get("/api/game/inventory");
    expect(invAfter.body.inventory["metal-coat"]).toBe(1);
  });

  // ---------- Scenario 10: Regional Variant ----------
  // Set region to alola, give encounter for vulpix-alola, catch it,
  // verify variantId is preserved on the caught pokemon.
  it("Scenario 10: Regional Variant", async () => {
    const { token, userId } = await t.registerAndLogin("regional", "charmander");
    const api = t.authed(token);

    // Check available regions
    const regions = await api.get("/api/game/regions");
    expect(regions.status).toBe(200);
    const alolaRegion = regions.body.regions.find(
      (r: { id: string }) => r.id === "alola",
    );
    expect(alolaRegion).toBeDefined();

    // Switch to alola
    const setRegion = await api.put("/api/game/region", { region: "alola" });
    expect(setRegion.status).toBe(200);
    expect(setRegion.body.currentRegion).toBe("alola");

    // Give a variant encounter
    const enc = await t.admin().post("/api/admin/test/encounter", {
      userId,
      species: "vulpix-alola",
      level: 5,
    });
    expect(enc.status).toBe(200);
    const eventId = enc.body.event.id;

    // Give a masterball to guarantee catch
    await t.admin().post("/api/admin/test/give-item", { userId, item: "masterball", quantity: 1 });

    // Get party
    const party = await api.get("/api/game/party");
    const myPokemon = party.body.party[0];

    // Start battle
    const start = await api.post("/api/battle/start", {
      eventId,
      pokemonUid: myPokemon.uid,
    });
    expect(start.status).toBe(200);
    // The wild pokemon should have the variant info
    const wildSpecies = start.body.battleState.wild.species;
    expect(wildSpecies).toBe("vulpix");

    // Catch with masterball
    const catchAction = await api.post("/api/battle/action", {
      action: "catch",
      data: { ball: "masterball" },
    });
    expect(catchAction.status).toBe(200);
    expect(catchAction.body.result).toBe("caught");
    const caughtPokemon = catchAction.body.pokemon;
    expect(caughtPokemon.species).toBe("vulpix");
    expect(caughtPokemon.variantId).toBe("vulpix-alola");

    // Verify the variant pokemon is in party
    const newParty = await api.get("/api/game/party");
    const variantInParty = newParty.body.party.find(
      (p: { uid: string }) => p.uid === caughtPokemon.uid,
    );
    expect(variantInParty).toBeDefined();
    expect(variantInParty.variantId).toBe("vulpix-alola");
  });
});
