import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { healPokemon } from "../game/inventory-utils.js";
import { equipHeldItem, unequipHeldItem } from "../game/held-item-usage.js";
import { buildInventoryCatalogEntry } from "../game/inventory-catalog.js";
import { GameRuleError } from "../game/game-errors.js";
import { getPartyPokemon } from "../game/pokemon-state.js";
import { childLogger } from "../logger.js";
const log = childLogger("item-routes");


export const itemRoutes = Router();
itemRoutes.use(authMiddleware);

itemRoutes.get("/inventory", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const config = await getConfig();
    const catalog = Object.fromEntries(
      Object.keys(user.inventory).map((itemId) => [
        itemId,
        buildInventoryCatalogEntry(itemId, config.shop.items[itemId]),
      ]),
    );

    res.json({ inventory: user.inventory, catalog });
  } catch (err) {
    log.error({ err }, "Inventory error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

itemRoutes.post("/items/equip", async (req: AuthRequest, res: Response) => {
  try {
    const { item, pokemonUid } = req.body;
    if (!item || !pokemonUid) {
      res.status(400).json({ error: "Item and pokemonUid are required." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const result = equipHeldItem(user, pokemonUid, item);
    await saveUser(user);

    res.json({
      message: `${result.pokemon.species} is now holding ${result.itemName}.`,
      pokemon: result.pokemon,
      previousHeldItem: result.previousHeldItem,
      inventory: user.inventory,
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Equip held item error");
    res.status(500).json({ error: "Failed to equip item." });
  }
});

itemRoutes.post("/items/unequip", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid } = req.body;
    if (!pokemonUid) {
      res.status(400).json({ error: "pokemonUid is required." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const result = unequipHeldItem(user, pokemonUid);
    await saveUser(user);

    res.json({
      message: `${result.pokemon.species} is no longer holding ${result.itemName}.`,
      pokemon: result.pokemon,
      inventory: user.inventory,
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Unequip held item error");
    res.status(500).json({ error: "Failed to unequip item." });
  }
});

itemRoutes.post("/heal", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const partyPokemon = getPartyPokemon(user);

    for (const p of partyPokemon) {
      healPokemon(p);
    }

    await saveUser(user);
    res.json({ healed: partyPokemon.length });
  } catch (err) {
    log.error({ err }, "Heal error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
