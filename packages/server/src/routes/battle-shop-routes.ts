import { Router } from "express";
import type { AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { incrementItem } from "../game/inventory-utils.js";
import { childLogger } from "../logger.js";

const log = childLogger("battle-shop-routes");

export const battleShopRoutes = Router();
battleShopRoutes.use(authMiddleware);

battleShopRoutes.get("/", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const config = await getConfig();
    res.json({ items: config.battleShop.items, battleMoney: user.battleMoney });
  } catch (err) {
    log.error({ err }, "Battle shop error");
    res.status(500).json({ error: "Failed to load battle shop." });
  }
});

battleShopRoutes.post("/buy", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { item, quantity } = req.body;

    const qty = Number(quantity);
    if (!item || !Number.isInteger(qty) || qty < 1) {
      res.status(400).json({ error: "Item and a positive integer quantity are required." });
      return;
    }

    const config = await getConfig();
    const shopItem = config.battleShop.items[item];
    if (!shopItem) {
      res.status(404).json({ error: "Battle shop item not found." });
      return;
    }

    const totalCost = shopItem.price * qty;

    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (user.battleMoney < totalCost) {
      res.status(400).json({ error: "Not enough battle money." });
      return;
    }

    user.battleMoney -= totalCost;
    incrementItem(user.inventory, item, qty);
    await saveUser(user);

    res.json({
      message: `Purchased ${qty} ${shopItem.name}.`,
      battleMoney: user.battleMoney,
      inventory: user.inventory,
    });
  } catch (err) {
    log.error({ err }, "Battle shop buy error");
    res.status(500).json({ error: "Failed to buy item." });
  }
});
