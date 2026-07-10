import { Router } from "express";
import type { AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withLock } from "../storage/pvp-store.js";
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
    res.json({ items: config.battleShop.items, gameMoney: user.gameMoney });
  } catch (err) {
    log.error({ err }, "Battle shop error");
    res.status(500).json({ error: "Failed to load battle shop." });
  }
});

battleShopRoutes.post("/buy", async (req, res) => {
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
    const shopItem = config.battleShop.items[item];
    if (!shopItem) {
      res.status(404).json({ error: "Battle shop item not found." });
      return;
    }

    const totalCost = shopItem.price * qty;

    await withLock(`user:${userId!}`, async () => {
      const user = await getUser(userId!);
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      if (user.gameMoney < totalCost) {
        res.status(400).json({ error: "Not enough game money." });
        return;
      }

      user.gameMoney -= totalCost;
      incrementItem(user.inventory, item, qty);
      await saveUser(user);

      res.json({
        message: `Purchased ${qty} ${shopItem.name}.`,
        gameMoney: user.gameMoney,
        inventory: user.inventory,
      });
    });
  } catch (err) {
    log.error({ err }, "Battle shop buy error");
    res.status(500).json({ error: "Failed to buy item." });
  }
});
