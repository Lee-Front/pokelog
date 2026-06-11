import { Router } from "express";
import { getAllUsers } from "../storage/user-store.js";
import { childLogger } from "../logger.js";
const log = childLogger("social-routes");


export const socialRoutes = Router();

socialRoutes.get("/ranking", async (req, res) => {
  try {
    const by = (req.query.by as string) || "exp";
    const users = await getAllUsers();

    const ranked = users.map((u) => ({
      nickname: u.account.nickname,
      totalExp: u.totalExp,
      points: u.points,
      pokedexCount: u.pokedex.length,
      topLevel: u.pokemon.reduce((max, p) => Math.max(max, p.level), 0),
    }));

    switch (by) {
      case "exp":
        ranked.sort((a, b) => b.totalExp - a.totalExp);
        break;
      case "level":
        ranked.sort((a, b) => b.topLevel - a.topLevel);
        break;
      case "pokedex":
        ranked.sort((a, b) => b.pokedexCount - a.pokedexCount);
        break;
      case "points":
        ranked.sort((a, b) => b.points - a.points);
        break;
      default:
        ranked.sort((a, b) => b.totalExp - a.totalExp);
    }

    res.json({ ranking: ranked });
  } catch (err) {
    log.error({ err }, "Ranking error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

socialRoutes.get("/profile/:nickname", async (req, res) => {
  try {
    const { nickname } = req.params;
    const users = await getAllUsers();
    const user = users.find((u) => u.account.nickname === nickname);

    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    res.json({
      nickname: user.account.nickname,
      createdAt: user.account.createdAt,
      totalExp: user.totalExp,
      points: user.points,
      pokedexCount: user.pokedex.length,
      pokemonCount: user.pokemon.length + user.storage.length,
      topLevel: user.pokemon.reduce((max, p) => Math.max(max, p.level), 0),
    });
  } catch (err) {
    log.error({ err }, "Public profile error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

