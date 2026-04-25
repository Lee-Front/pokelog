import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { MAX_PARTY_SIZE } from "../../../../shared/types.js";

export const storageRoutes = Router();
storageRoutes.use(authMiddleware);

storageRoutes.get("/storage", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    res.json({ storage: user.storage });
  } catch (err) {
    console.error("Storage error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

storageRoutes.post("/storage/withdraw", async (req: AuthRequest, res: Response) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      res.status(400).json({ error: "포켓몬 UID를 입력해주세요" });
      return;
    }

    type Outcome =
      | { kind: "ok"; uid: string }
      | { kind: "error"; status: number; message: string };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "error", status: 404, message: "사용자를 찾을 수 없습니다" };
      if (user.party.length >= MAX_PARTY_SIZE) {
        return { kind: "error", status: 400, message: "파티가 가득 찼습니다" };
      }
      const pokemonIndex = user.storage.findIndex((p) => p.uid === uid);
      if (pokemonIndex === -1) {
        return { kind: "error", status: 404, message: "보관함에서 포켓몬을 찾을 수 없습니다" };
      }
      const [pokemon] = user.storage.splice(pokemonIndex, 1);
      user.pokemon.push(pokemon);
      user.party.push(pokemon.uid);
      await saveUser(user);
      return { kind: "ok", uid: pokemon.uid };
    });

    if (outcome.kind === "error") {
      res.status(outcome.status).json({ error: outcome.message });
      return;
    }
    res.json({ message: "포켓몬을 꺼냈습니다", uid: outcome.uid });
  } catch (err) {
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

storageRoutes.post("/storage/deposit", async (req: AuthRequest, res: Response) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      res.status(400).json({ error: "포켓몬 UID를 입력해주세요" });
      return;
    }

    type Outcome =
      | { kind: "ok"; uid: string }
      | { kind: "error"; status: number; message: string };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "error", status: 404, message: "사용자를 찾을 수 없습니다" };
      if (user.party.length <= 1) {
        return { kind: "error", status: 400, message: "파티에 최소 1마리는 있어야 합니다" };
      }
      const pokemonIndex = user.pokemon.findIndex((p) => p.uid === uid);
      if (pokemonIndex === -1) {
        return { kind: "error", status: 404, message: "포켓몬을 찾을 수 없습니다" };
      }
      if (!user.party.includes(uid)) {
        return { kind: "error", status: 400, message: "파티에 있는 포켓몬만 맡길 수 있습니다" };
      }
      const [pokemon] = user.pokemon.splice(pokemonIndex, 1);
      user.party = user.party.filter((u) => u !== uid);
      user.storage.push(pokemon);
      await saveUser(user);
      return { kind: "ok", uid: pokemon.uid };
    });

    if (outcome.kind === "error") {
      res.status(outcome.status).json({ error: outcome.message });
      return;
    }
    res.json({ message: "포켓몬을 맡겼습니다", uid: outcome.uid });
  } catch (err) {
    console.error("Deposit error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
