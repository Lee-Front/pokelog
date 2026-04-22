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
    console.error("Inventory error:", err);
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

    console.error("Equip held item error:", err);
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

    console.error("Unequip held item error:", err);
    res.status(500).json({ error: "Failed to unequip item." });
  }
});

const VALID_TERA_TYPES = new Set([
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
  "stellar",
]);

const TERA_SHARD_COST = 50;

itemRoutes.post("/change-tera-type", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid, teraType } = req.body ?? {};
    if (!pokemonUid || typeof teraType !== "string") {
      res.status(400).json({ error: "pokemonUid와 teraType이 필요합니다" });
      return;
    }
    if (!VALID_TERA_TYPES.has(teraType)) {
      res.status(400).json({ error: "유효하지 않은 테라 타입입니다" });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const poke =
      user.pokemon.find((p) => p.uid === pokemonUid) ??
      user.storage.find((p) => p.uid === pokemonUid);
    if (!poke) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    const shardId = `tera-shard-${teraType}`;
    const owned = user.inventory[shardId] ?? 0;
    if (owned < TERA_SHARD_COST) {
      res.status(400).json({ error: `${shardId}이(가) ${TERA_SHARD_COST}개 필요합니다` });
      return;
    }

    user.inventory[shardId] = owned - TERA_SHARD_COST;
    if (user.inventory[shardId] <= 0) {
      delete user.inventory[shardId];
    }
    poke.teraType = teraType;
    await saveUser(user);

    res.json({ pokemon: poke, inventory: user.inventory });
  } catch (err) {
    console.error("Change tera type error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
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
    console.error("Heal error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
