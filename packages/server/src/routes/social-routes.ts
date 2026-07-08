import { Router } from "express";
import { getAllUsers } from "../storage/user-store.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { childLogger } from "../logger.js";
const log = childLogger("social-routes");


export const socialRoutes = Router();

/** 유저 보유 개체(파티풀 ∪ 보관함) 중 이로치(isShiny) 수. */
function shinyCountOf(u: Awaited<ReturnType<typeof getAllUsers>>[number]): number {
  return [...u.pokemon, ...u.storage].filter((p) => p.isShiny === true).length;
}

/** 도감(영구 기록, user.pokedex)에 등록된 종 중 전설/환상 종 수 — 방생해도 유지되는 "잡아본 적 있는" 지표. */
function legendaryCountOf(u: Awaited<ReturnType<typeof getAllUsers>>[number]): number {
  return u.pokedex.filter((species) => {
    const data = getSpeciesByName(species);
    return data?.isLegendary || data?.isMythical;
  }).length;
}

// 레벨은 100에서 캡되고(무한정 성장 X) 경험치는 커밋이 더는 주지 않아 랭킹으로서 의미가 옅어져
// exp/level 탭은 제거했다 — 수집(도감/이로치/전설·환상)과 포인트만 남긴다.
socialRoutes.get("/ranking", async (req, res) => {
  try {
    const by = (req.query.by as string) || "pokedex";
    const users = await getAllUsers();

    const ranked = users.map((u) => ({
      nickname: u.account.nickname,
      points: u.points,
      pokedexCount: u.pokedex.length,
      shinyCount: shinyCountOf(u),
      legendaryCount: legendaryCountOf(u),
    }));

    switch (by) {
      case "points":
        ranked.sort((a, b) => b.points - a.points);
        break;
      case "shiny":
        ranked.sort((a, b) => b.shinyCount - a.shinyCount);
        break;
      case "legendary":
        ranked.sort((a, b) => b.legendaryCount - a.legendaryCount);
        break;
      case "pokedex":
      default:
        ranked.sort((a, b) => b.pokedexCount - a.pokedexCount);
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

