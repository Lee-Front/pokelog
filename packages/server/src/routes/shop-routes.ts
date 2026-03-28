import { Router } from "express";
import type { AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { decrementItem, incrementItem, healPokemon } from "../game/inventory-utils.js";

export const shopRoutes = Router();
shopRoutes.use(authMiddleware);

shopRoutes.get("/", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const config = await getConfig();
    res.json({ items: config.shop.items, points: user.points });
  } catch (err) {
    console.error("Shop error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

shopRoutes.post("/buy", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { item, quantity } = req.body;

    if (!item || !quantity || quantity < 1) {
      res.status(400).json({ error: "아이템과 수량을 입력해주세요" });
      return;
    }

    const config = await getConfig();
    const shopItem = config.shop.items[item];
    if (!shopItem) {
      res.status(404).json({ error: "존재하지 않는 아이템입니다" });
      return;
    }

    const totalCost = shopItem.price * quantity;

    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (user.points < totalCost) {
      res.status(400).json({ error: "포인트가 부족합니다" });
      return;
    }

    user.points -= totalCost;
    incrementItem(user.inventory, item, quantity);
    await saveUser(user);

    res.json({
      message: `${shopItem.name} ${quantity}개를 구매했습니다`,
      points: user.points,
      inventory: user.inventory,
    });
  } catch (err) {
    console.error("Buy error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

shopRoutes.post("/use", async (req, res) => {
  try {
    const { userId } = req as AuthRequest;
    const { item, pokemonUid } = req.body;

    if (!item || !pokemonUid) {
      res.status(400).json({ error: "아이템과 포켓몬 UID를 입력해주세요" });
      return;
    }

    const config = await getConfig();
    const shopItem = config.shop.items[item];
    if (!shopItem || !shopItem.healAmount) {
      res.status(400).json({ error: "사용할 수 없는 아이템입니다" });
      return;
    }

    const user = await getUser(userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (!user.inventory[item] || user.inventory[item] <= 0) {
      res.status(400).json({ error: "아이템이 없습니다" });
      return;
    }

    const pokemon = user.pokemon.find((p) => p.uid === pokemonUid);
    if (!pokemon) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    if (pokemon.hp >= pokemon.maxHp) {
      res.status(400).json({ error: "이미 체력이 가득 찼습니다" });
      return;
    }

    decrementItem(user.inventory, item);
    healPokemon(pokemon, shopItem.healAmount);
    await saveUser(user);

    res.json({
      message: `${shopItem.name}을(를) 사용했습니다`,
      pokemon: { uid: pokemon.uid, hp: pokemon.hp, maxHp: pokemon.maxHp },
    });
  } catch (err) {
    console.error("Use item error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

