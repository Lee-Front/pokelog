import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { fusePokemon, unfusePokemon } from "../game/fusion.js";

export const fusionRoutes = Router();
fusionRoutes.use(authMiddleware);

fusionRoutes.post("/fusion/fuse", async (req: AuthRequest, res: Response) => {
  try {
    const { baseUid, partnerUid, itemId } = req.body ?? {};
    if (!baseUid || !partnerUid || !itemId) {
      res.status(400).json({ error: "baseUid, partnerUid, itemId가 필요합니다" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };

      const result = fusePokemon(user, baseUid, partnerUid, itemId);
      if (!result.ok) return { kind: "game_error" as const, error: result.error ?? "합체 실패" };

      await saveUser(user);
      return {
        kind: "ok" as const,
        pokemon: user.pokemon,
        party: user.party,
        inventory: user.inventory,
        fusedPokemon: result.fusedPokemon,
      };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "game_error") {
      res.status(400).json({ error: outcome.error });
      return;
    }

    res.json({
      pokemon: outcome.pokemon,
      party: outcome.party,
      inventory: outcome.inventory,
      fusedPokemon: outcome.fusedPokemon,
    });
  } catch (err) {
    console.error("Fusion fuse error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

fusionRoutes.post("/fusion/unfuse", async (req: AuthRequest, res: Response) => {
  try {
    const { fusedUid } = req.body ?? {};
    if (!fusedUid) {
      res.status(400).json({ error: "fusedUid가 필요합니다" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };

      const result = unfusePokemon(user, fusedUid);
      if (!result.ok) return { kind: "game_error" as const, error: result.error ?? "해제 실패" };

      await saveUser(user);
      return {
        kind: "ok" as const,
        pokemon: user.pokemon,
        party: user.party,
        basePokemon: result.fusedPokemon,
      };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "game_error") {
      res.status(400).json({ error: outcome.error });
      return;
    }

    res.json({
      pokemon: outcome.pokemon,
      party: outcome.party,
      basePokemon: outcome.basePokemon,
    });
  } catch (err) {
    console.error("Fusion unfuse error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
