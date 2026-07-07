import { Router } from "express";
import type { AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { incrementItem, resolveShopItem } from "../game/inventory-utils.js";
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
    // 회복약 등은 게임머니 상점(battleShop)으로 이동했으므로 두 카탈로그를 모두 조회한다.
    const shopItem = resolveShopItem(config, item);

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

    if (result.kind === "status-cure") {
      res.json({
        kind: result.kind,
        message: `${result.itemName} used successfully.`,
        pokemon: {
          uid: result.pokemon.uid,
          hp: result.pokemon.hp,
          maxHp: result.pokemon.maxHp,
          statusCondition: result.pokemon.statusCondition ?? null,
        },
        inventory: user.inventory,
      });
      return;
    }

    if (result.kind === "gmax-factor") {
      res.json({
        kind: result.kind,
        message: `${result.pokemon.species}이(가) 거다이맥스할 수 있게 되었다!`,
        pokemon: result.pokemon,
        inventory: user.inventory,
      });
      return;
    }

    // 특성 변경(특성캡슐/특성패치) — item-usage가 만든 안내 메시지와 바뀐 특성을 그대로 전달한다.
    if (result.kind === "ability") {
      res.json({
        kind: result.kind,
        message: result.message ?? `${result.itemName} used successfully.`,
        abilityId: result.abilityId ?? null,
        pokemon: result.pokemon,
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
