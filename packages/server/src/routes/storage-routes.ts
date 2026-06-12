import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { childLogger } from "../logger.js";
const log = childLogger("storage-routes");


const MAX_PARTY_SIZE = 6;

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
    log.error({ err }, "Storage error");
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

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (user.party.length >= MAX_PARTY_SIZE) {
      res.status(400).json({ error: "파티가 가득 찼습니다" });
      return;
    }

    const pokemonIndex = user.storage.findIndex((p) => p.uid === uid);
    if (pokemonIndex === -1) {
      res.status(404).json({ error: "보관함에서 포켓몬을 찾을 수 없습니다" });
      return;
    }

    const [pokemon] = user.storage.splice(pokemonIndex, 1);
    user.pokemon.push(pokemon);
    user.party.push(pokemon.uid);
    await saveUser(user);
    res.json({ message: "포켓몬을 꺼냈습니다", uid: pokemon.uid });
  } catch (err) {
    log.error({ err }, "Withdraw error");
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

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (user.party.length <= 1) {
      res.status(400).json({ error: "파티에 최소 1마리는 있어야 합니다" });
      return;
    }

    const pokemonIndex = user.pokemon.findIndex((p) => p.uid === uid);
    if (pokemonIndex === -1) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    if (!user.party.includes(uid)) {
      res.status(400).json({ error: "파티에 있는 포켓몬만 맡길 수 있습니다" });
      return;
    }

    const [pokemon] = user.pokemon.splice(pokemonIndex, 1);
    user.party = user.party.filter((u) => u !== uid);
    user.storage.push(pokemon);
    await saveUser(user);
    res.json({ message: "포켓몬을 맡겼습니다", uid: pokemon.uid });
  } catch (err) {
    log.error({ err }, "Deposit error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

// 포켓몬 풀어주기: 파티/보관함에서 영구 제거. 파티 마지막 1마리는 전멸 방지를 위해 금지.
storageRoutes.post("/pokemon/:uid/release", async (req: AuthRequest, res: Response) => {
  try {
    const { uid } = req.params;

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const inParty = user.party.includes(uid);
    const partyIndex = user.pokemon.findIndex((p) => p.uid === uid);
    const storageIndex = user.storage.findIndex((p) => p.uid === uid);

    if (partyIndex === -1 && storageIndex === -1) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    // 파티의 유일한 1마리는 풀어줄 수 없다(전멸 방지). 보관함이거나 파티에 2마리+ 일 때만 허용.
    if (inParty && user.party.length <= 1) {
      res.status(400).json({ error: "마지막 포켓몬은 풀어줄 수 없습니다" });
      return;
    }

    if (partyIndex !== -1) {
      user.pokemon.splice(partyIndex, 1);
      user.party = user.party.filter((u) => u !== uid);
    } else {
      user.storage.splice(storageIndex, 1);
    }
    await saveUser(user);
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Release error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
