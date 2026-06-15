import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { createEgg, getEggTierSummaries, hatchEgg } from "../game/egg-gacha.js";
import { childLogger } from "../logger.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";
const log = childLogger("egg-routes");


const MAX_PARTY_SIZE = 6;

// 부화한 포켓몬을 파티에 넣되, 파티가 꽉 차면 보관함으로 보낸다.
// 도감 등록도 함께 처리하고, 어디로 갔는지 반환한다.
function placeHatched(user: UserData, pokemon: OwnedPokemon): "party" | "storage" {
  user.pokemon.push(pokemon);
  let destination: "party" | "storage";
  if (user.party.length < MAX_PARTY_SIZE) {
    user.party.push(pokemon.uid);
    destination = "party";
  } else {
    user.storage.push(pokemon);
    destination = "storage";
  }

  if (!user.pokedex.includes(pokemon.species)) {
    user.pokedex.push(pokemon.species);
  }

  return destination;
}

export const eggRoutes = Router();
eggRoutes.use(authMiddleware);

eggRoutes.get("/eggs", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    res.json({
      points: user.points,
      tiers: await getEggTierSummaries(),
      eggs: user.eggs,
    });
  } catch (err) {
    log.error({ err }, "Egg overview error");
    res.status(500).json({ error: "알 정보를 불러오지 못했습니다" });
  }
});

// 알 구매는 보관 없이 즉시 부화한다(pull과 동일). 보관 알 폐지.
eggRoutes.post("/eggs/buy", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const tier = String(req.body.tier ?? "");
    const tierInfo = (await getEggTierSummaries()).find((entry) => entry.tier === tier);
    if (!tierInfo) {
      res.status(400).json({ error: "올바른 알 티어를 선택해주세요 (common, rare, legend)" });
      return;
    }

    if (user.points < tierInfo.cost) {
      res.status(400).json({ error: `포인트가 부족합니다 (필요: ${tierInfo.cost}, 보유: ${user.points})` });
      return;
    }

    const egg = createEgg(tierInfo.tier);
    user.points -= tierInfo.cost;

    const { pokemon, label } = await hatchEgg(egg);
    const destination = placeHatched(user, pokemon);

    await saveUser(user);
    res.json({
      egg: { id: egg.id, tier: egg.tier, label },
      pokemon,
      destination,
      toBox: destination === "storage",
      cost: tierInfo.cost,
      remainingPoints: user.points,
    });
  } catch (err) {
    log.error({ err }, "Egg buy error");
    res.status(500).json({ error: "알 구매 중 오류가 발생했습니다" });
  }
});

eggRoutes.post("/eggs/hatch", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const eggId = String(req.body.eggId ?? "");
    if (!eggId) {
      res.status(400).json({ error: "알 ID를 입력해주세요" });
      return;
    }

    const eggIndex = user.eggs.findIndex((egg) => egg.id === eggId);
    if (eggIndex === -1) {
      res.status(404).json({ error: "알을 찾을 수 없습니다" });
      return;
    }

    const [egg] = user.eggs.splice(eggIndex, 1);
    const { pokemon, label } = await hatchEgg(egg);
    const destination = placeHatched(user, pokemon);

    await saveUser(user);
    res.json({
      egg: { id: egg.id, tier: egg.tier, label },
      pokemon,
      destination,
      toBox: destination === "storage",
    });
  } catch (err) {
    log.error({ err }, "Egg hatch error");
    res.status(500).json({ error: "알 부화 중 오류가 발생했습니다" });
  }
});

// 남은 보관 알을 한 번에 정리(즉시부화 전환에 따른 일괄 부화). 보관 알이 없으면 빈 결과.
eggRoutes.post("/eggs/hatch-all", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const eggs = user.eggs.splice(0, user.eggs.length);
    const hatched = [];
    for (const egg of eggs) {
      const { pokemon, label } = await hatchEgg(egg);
      const destination = placeHatched(user, pokemon);
      hatched.push({
        egg: { id: egg.id, tier: egg.tier, label },
        pokemon,
        destination,
        toBox: destination === "storage",
      });
    }

    if (hatched.length > 0) {
      await saveUser(user);
    }
    res.json({ hatched, count: hatched.length });
  } catch (err) {
    log.error({ err }, "Egg hatch-all error");
    res.status(500).json({ error: "알 일괄 부화 중 오류가 발생했습니다" });
  }
});

eggRoutes.post("/eggs/pull", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const tier = String(req.body.tier ?? "");
    const tierInfo = (await getEggTierSummaries()).find((entry) => entry.tier === tier);
    if (!tierInfo) {
      res.status(400).json({ error: "올바른 티어를 선택해주세요 (common, rare, legend)" });
      return;
    }

    if (user.points < tierInfo.cost) {
      res.status(400).json({ error: `포인트가 부족합니다 (필요: ${tierInfo.cost}, 보유: ${user.points})` });
      return;
    }

    const egg = createEgg(tierInfo.tier);
    user.points -= tierInfo.cost;

    const { pokemon } = await hatchEgg(egg);
    const destination = placeHatched(user, pokemon);

    await saveUser(user);
    res.json({
      pokemon,
      destination,
      toBox: destination === "storage",
      cost: tierInfo.cost,
      remainingPoints: user.points,
    });
  } catch (err) {
    log.error({ err }, "Egg pull error");
    res.status(500).json({ error: "뽑기 중 오류가 발생했습니다" });
  }
});
