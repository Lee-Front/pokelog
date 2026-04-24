import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { createEgg, getEggTierSummaries, hatchEgg } from "../game/egg-gacha.js";
import { MAX_PARTY_SIZE } from "../../../../shared/types.js";

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
      tiers: getEggTierSummaries(),
      eggs: user.eggs,
    });
  } catch (err) {
    console.error("Egg overview error:", err);
    res.status(500).json({ error: "알 정보를 불러오지 못했습니다" });
  }
});

eggRoutes.post("/eggs/buy", async (req: AuthRequest, res: Response) => {
  try {
    const tier = String(req.body.tier ?? "");
    const tierInfo = getEggTierSummaries().find((entry) => entry.tier === tier);
    if (!tierInfo) {
      res.status(400).json({ error: "올바른 알 티어를 선택해주세요 (common, rare, legend)" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };

      if (user.points < tierInfo.cost) {
        return { kind: "insufficient" as const, cost: tierInfo.cost, have: user.points };
      }

      const egg = createEgg(tierInfo.tier);
      user.points -= tierInfo.cost;
      user.eggs.push(egg);

      await saveUser(user);
      return { kind: "ok" as const, egg, points: user.points };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "insufficient") {
      res.status(400).json({ error: `포인트가 부족합니다 (필요: ${outcome.cost}, 보유: ${outcome.have})` });
      return;
    }

    res.json({
      egg: outcome.egg,
      cost: tierInfo.cost,
      remainingPoints: outcome.points,
    });
  } catch (err) {
    console.error("Egg buy error:", err);
    res.status(500).json({ error: "알 구매 중 오류가 발생했습니다" });
  }
});

eggRoutes.post("/eggs/hatch", async (req: AuthRequest, res: Response) => {
  try {
    const eggId = String(req.body.eggId ?? "");
    if (!eggId) {
      res.status(400).json({ error: "알 ID를 입력해주세요" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };

      const eggIndex = user.eggs.findIndex((egg) => egg.id === eggId);
      if (eggIndex === -1) return { kind: "no_egg" as const };

      const [egg] = user.eggs.splice(eggIndex, 1);
      const { pokemon, label } = hatchEgg(egg);

      let destination: "party" | "storage" = "storage";
      if (user.party.length < MAX_PARTY_SIZE) {
        user.pokemon.push(pokemon);
        user.party.push(pokemon.uid);
        destination = "party";
      } else {
        user.storage.push(pokemon);
      }

      if (!user.pokedex.includes(pokemon.species)) {
        user.pokedex.push(pokemon.species);
      }

      await saveUser(user);
      return {
        kind: "ok" as const,
        egg: { id: egg.id, tier: egg.tier, label },
        pokemon,
        destination,
      };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "no_egg") {
      res.status(404).json({ error: "알을 찾을 수 없습니다" });
      return;
    }

    res.json({
      egg: outcome.egg,
      pokemon: outcome.pokemon,
      destination: outcome.destination,
    });
  } catch (err) {
    console.error("Egg hatch error:", err);
    res.status(500).json({ error: "알 부화 중 오류가 발생했습니다" });
  }
});

eggRoutes.post("/eggs/pull", async (req: AuthRequest, res: Response) => {
  try {
    const tier = String(req.body.tier ?? "");
    const tierInfo = getEggTierSummaries().find((entry) => entry.tier === tier);
    if (!tierInfo) {
      res.status(400).json({ error: "올바른 티어를 선택해주세요 (common, rare, legend)" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };

      if (user.points < tierInfo.cost) {
        return { kind: "insufficient" as const, cost: tierInfo.cost, have: user.points };
      }

      const egg = createEgg(tierInfo.tier);
      user.points -= tierInfo.cost;

      const { pokemon } = hatchEgg(egg);

      let destination: "party" | "storage" = "storage";
      if (user.party.length < MAX_PARTY_SIZE) {
        user.pokemon.push(pokemon);
        user.party.push(pokemon.uid);
        destination = "party";
      } else {
        user.storage.push(pokemon);
      }

      if (!user.pokedex.includes(pokemon.species)) {
        user.pokedex.push(pokemon.species);
      }

      await saveUser(user);
      return { kind: "ok" as const, pokemon, destination, points: user.points };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "insufficient") {
      res.status(400).json({ error: `포인트가 부족합니다 (필요: ${outcome.cost}, 보유: ${outcome.have})` });
      return;
    }

    res.json({
      pokemon: outcome.pokemon,
      destination: outcome.destination,
      cost: tierInfo.cost,
      remainingPoints: outcome.points,
    });
  } catch (err) {
    console.error("Egg pull error:", err);
    res.status(500).json({ error: "뽑기 중 오류가 발생했습니다" });
  }
});
