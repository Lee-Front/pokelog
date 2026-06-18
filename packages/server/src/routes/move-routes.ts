import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getMoveDisplayName, resolvePendingMoveLearn } from "../game/pending-move-learn.js";
import { GameRuleError } from "../game/game-errors.js";
import { findPokemonByUid } from "../game/pokemon-state.js";
import { childLogger } from "../logger.js";
const log = childLogger("move-routes");


export const moveRoutes = Router();
moveRoutes.use(authMiddleware);

// 대기 중 기술 배우기 조회 — 각 대기에 대상 포켓몬과 현재 기술 목록을 함께 내려 표시를 돕는다.
moveRoutes.get("/moves/pending", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const pending = (user.pendingMoveLearns ?? []).map((entry) => {
      const pokemon = findPokemonByUid(user, entry.pokemonUid) ?? null;
      return {
        ...entry,
        moveName: getMoveDisplayName(entry.moveId),
        pokemon,
        currentMoves: pokemon?.moves ?? [],
      };
    });

    res.json({ pending });
  } catch (err) {
    log.error({ err }, "Pending move learns error");
    res.status(500).json({ error: "Failed to load pending move learns." });
  }
});

// 대기 중 기술 배우기 처리 — forgetMoveId 지정 시 그 기술을 잊고 배우고, 없으면 안 배운다(SKIP).
moveRoutes.post("/moves/resolve", async (req: AuthRequest, res: Response) => {
  try {
    const { pendingMoveLearnId, forgetMoveId } = req.body;
    if (!pendingMoveLearnId) {
      res.status(400).json({ error: "pendingMoveLearnId is required." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const result = resolvePendingMoveLearn(
      user,
      pendingMoveLearnId,
      typeof forgetMoveId === "string" ? forgetMoveId : null,
    );
    await saveUser(user);

    const message = result.skipped
      ? `${getMoveDisplayName(result.pendingMoveLearn.moveId)} was not learned.`
      : result.learnedMoveId
        ? `${result.pokemon.species} learned ${getMoveDisplayName(result.learnedMoveId)}.`
        : `${getMoveDisplayName(result.pendingMoveLearn.moveId)} is already known.`;

    res.json({
      message,
      pokemon: result.pokemon,
      remainingPending: user.pendingMoveLearns ?? [],
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Resolve move learn error");
    res.status(500).json({ error: "Failed to resolve pending move learn." });
  }
});
