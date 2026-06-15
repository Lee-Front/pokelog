import { Router } from "express";
import type { AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { incrementItem } from "../game/inventory-utils.js";
import { useInventoryItem } from "../game/item-usage.js";
import { GameRuleError } from "../game/game-errors.js";
import { childLogger } from "../logger.js";
const log = childLogger("shop-routes");


export const shopRoutes = Router();
shopRoutes.use(authMiddleware);

shopRoutes.get("/", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const config = await getConfig();
    res.json({ items: config.shop.items, points: user.points });
  } catch (err) {
    log.error({ err }, "Shop error");
    res.status(500).json({ error: "Failed to load shop." });
  }
});

shopRoutes.post("/buy", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { item, quantity } = req.body;

    // 수량 미지정은 단건(1)으로 호환. 양의 정수, 상한 99.
    const qty = quantity === undefined ? 1 : Number(quantity);
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      res.status(400).json({ error: "Item and a quantity between 1 and 99 are required." });
      return;
    }

    const config = await getConfig();
    const shopItem = config.shop.items[item];
    if (!shopItem) {
      res.status(404).json({ error: "Shop item not found." });
      return;
    }

    const totalCost = shopItem.price * qty;

    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (user.points < totalCost) {
      res.status(400).json({ error: "Not enough points." });
      return;
    }

    user.points -= totalCost;
    incrementItem(user.inventory, item, qty);
    await saveUser(user, "shop-purchase");

    res.json({
      message: `Purchased ${qty} ${shopItem.name}.`,
      points: user.points,
      inventory: user.inventory,
    });
  } catch (err) {
    log.error({ err }, "Buy error");
    res.status(500).json({ error: "Failed to buy item." });
  }
});

shopRoutes.post("/use", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { item, pokemonUid } = req.body;

    if (!item || !pokemonUid) {
      res.status(400).json({ error: "Item and pokemonUid are required." });
      return;
    }

    const config = await getConfig();
    const shopItem = config.shop.items[item];

    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const result = useInventoryItem(user, item, pokemonUid, shopItem);
    await saveUser(user);

    if (result.kind === "healing") {
      res.json({
        kind: result.kind,
        message: `${result.itemName} used successfully.`,
        pokemon: { uid: result.pokemon.uid, hp: result.pokemon.hp, maxHp: result.pokemon.maxHp },
        inventory: user.inventory,
      });
      return;
    }

    res.json({
      kind: result.kind,
      message: `${result.previousSpecies} evolved into ${result.pokemon.species} using ${result.itemName}.`,
      pokemon: result.pokemon,
      inventory: user.inventory,
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Use item error");
    res.status(500).json({ error: "Failed to use item." });
  }
});
