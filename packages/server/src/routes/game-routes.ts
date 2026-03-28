import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getAllSpecies } from "../game/pokemon-factory.js";
import { getRegion } from "../game/data-loader.js";
import { healPokemon } from "../game/inventory-utils.js";
const MAX_PARTY_SIZE = 6;

export const gameRoutes = Router();
gameRoutes.use(authMiddleware);

gameRoutes.get("/status", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const now = new Date();
    const pendingCount = user.pendingEvents.filter(
      (e) => new Date(e.expiresAt) > now,
    ).length;

    const today = now.toISOString().slice(0, 10);
    const todayLogs = user.log.filter((l) => l.timestamp.startsWith(today));

    res.json({
      nickname: user.account.nickname,
      points: user.points,
      totalExp: user.totalExp,
      combo: user.combo,
      pendingEventCount: pendingCount,
      todayLog: todayLogs,
      region: getRegion("default").name,
    });
  } catch (err) {
    console.error("Status error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/events", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const now = new Date();
    const activeEvents = user.pendingEvents.filter(
      (e) => new Date(e.expiresAt) > now,
    );

    // 만료된 이벤트 정리
    if (activeEvents.length !== user.pendingEvents.length) {
      user.pendingEvents = activeEvents;
      await saveUser(user);
    }

    res.json({ events: activeEvents });
  } catch (err) {
    console.error("Events error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/party", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const partyPokemon = user.party
      .map((uid) => user.pokemon.find((p) => p.uid === uid))
      .filter(Boolean);

    res.json({ party: partyPokemon });
  } catch (err) {
    console.error("Party error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.put("/party", async (req: AuthRequest, res: Response) => {
  try {
    const { uids } = req.body;
    if (!Array.isArray(uids) || uids.length === 0) {
      res.status(400).json({ error: "파티 포켓몬을 선택해주세요" });
      return;
    }

    if (uids.length > MAX_PARTY_SIZE) {
      res.status(400).json({ error: `파티는 최대 ${MAX_PARTY_SIZE}마리입니다` });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const allUids = user.pokemon.map((p) => p.uid);
    const invalid = uids.filter((uid: string) => !allUids.includes(uid));
    if (invalid.length > 0) {
      res.status(400).json({ error: "존재하지 않는 포켓몬이 포함되어 있습니다" });
      return;
    }

    user.party = uids;
    await saveUser(user);
    res.json({ party: uids });
  } catch (err) {
    console.error("Party update error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/pokemon/:uid", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const pokemon = user.pokemon.find((p) => p.uid === req.params.uid)
      ?? user.storage.find((p) => p.uid === req.params.uid);

    if (!pokemon) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    res.json({ pokemon });
  } catch (err) {
    console.error("Pokemon detail error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/pokedex", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const caughtSpecies = new Set([
      ...user.pokemon.map((p) => p.species),
      ...user.storage.map((p) => p.species),
    ]);

    res.json({
      seen: user.pokedex,
      caught: [...caughtSpecies],
      allSpecies: getAllSpecies(),
    });
  } catch (err) {
    console.error("Pokedex error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/inventory", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    res.json({ inventory: user.inventory });
  } catch (err) {
    console.error("Inventory error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/storage", async (req: AuthRequest, res: Response) => {
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

gameRoutes.post("/heal", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const partyPokemon = user.party
      .map((uid) => user.pokemon.find((p) => p.uid === uid))
      .filter(Boolean);

    for (const p of partyPokemon) {
      healPokemon(p!);
    }

    await saveUser(user);
    res.json({ healed: partyPokemon.length });
  } catch (err) {
    console.error("Heal error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.post("/storage/withdraw", async (req: AuthRequest, res: Response) => {
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
    console.error("Withdraw error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.post("/storage/deposit", async (req: AuthRequest, res: Response) => {
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
    console.error("Deposit error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
