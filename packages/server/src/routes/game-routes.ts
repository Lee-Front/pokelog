import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { getAllSpecies } from "../game/pokemon-factory.js";
import { getRegion, getRegionNames, getSpeciesByName } from "../game/data-loader.js";
import { healPokemon } from "../game/inventory-utils.js";
import { createEgg, getEggTierSummaries, hatchEgg } from "../game/egg-gacha.js";
import { equipHeldItem, HeldItemError, unequipHeldItem } from "../game/held-item-usage.js";
import { buildInventoryCatalogEntry } from "../game/inventory-catalog.js";
import { PendingEvolutionError, resolvePendingEvolutionChoice } from "../game/pending-evolution.js";
import { buildLevelEvolutionContext, getEvolutionBranchDiagnostics } from "../game/growth.js";
import {
  acceptTradeRequest,
  cancelTradeRequest,
  createTradeRequest,
  listTradeCandidates,
  listTradesForUser,
  rejectTradeRequest,
  TradeError,
} from "../game/trade.js";
const MAX_PARTY_SIZE = 6;

export const gameRoutes = Router();
gameRoutes.use(authMiddleware);

async function buildTradeView(
  currentUserId: string,
  trade: {
    id: string;
    requesterUserId: string;
    requesterPokemonUid: string;
    responderUserId: string;
    responderPokemonUid: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt?: string;
  },
) {
  const [requester, responder] = await Promise.all([
    getUser(trade.requesterUserId),
    getUser(trade.responderUserId),
  ]);

  const requesterPokemon = requester?.pokemon.find((pokemon) => pokemon.uid === trade.requesterPokemonUid)
    ?? requester?.storage.find((pokemon) => pokemon.uid === trade.requesterPokemonUid);
  const responderPokemon = responder?.pokemon.find((pokemon) => pokemon.uid === trade.responderPokemonUid)
    ?? responder?.storage.find((pokemon) => pokemon.uid === trade.responderPokemonUid);

  return {
    id: trade.id,
    status: trade.status,
    createdAt: trade.createdAt,
    updatedAt: trade.updatedAt,
    resolvedAt: trade.resolvedAt ?? null,
    direction: trade.requesterUserId === currentUserId ? "outgoing" : "incoming",
    requester: {
      userId: trade.requesterUserId,
      nickname: requester?.account.nickname ?? trade.requesterUserId,
      pokemonUid: trade.requesterPokemonUid,
      species: requesterPokemon?.species ?? null,
      speciesName: requesterPokemon ? (getSpeciesByName(requesterPokemon.species)?.name ?? requesterPokemon.species) : null,
    },
    responder: {
      userId: trade.responderUserId,
      nickname: responder?.account.nickname ?? trade.responderUserId,
      pokemonUid: trade.responderPokemonUid,
      species: responderPokemon?.species ?? null,
      speciesName: responderPokemon ? (getSpeciesByName(responderPokemon.species)?.name ?? responderPokemon.species) : null,
    },
  };
}

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
      pendingEvolutionCount: user.pendingEvolutions?.length ?? 0,
      todayLog: todayLogs,
      region: (() => { try { return getRegion(user.currentRegion ?? "default").name; } catch { return user.currentRegion ?? "default"; } })(),
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

gameRoutes.get("/history", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 20) || 20));
    const recent = [...user.log]
      .slice(-limit)
      .reverse()
      .map((entry) => ({
        timestamp: entry.timestamp,
        source: getLogSource(entry),
        type: entry.type,
        points: Number(entry.points ?? 0),
        exp: Number(entry.exp ?? 0),
        summary: getLogSummary(entry),
      }));

    const totals = user.log.reduce<Record<string, { points: number; exp: number; count: number }>>((acc, entry) => {
      const source = getLogSource(entry);
      if (!acc[source]) {
        acc[source] = { points: 0, exp: 0, count: 0 };
      }
      acc[source].points += Number(entry.points ?? 0);
      acc[source].exp += Number(entry.exp ?? 0);
      acc[source].count += 1;
      return acc;
    }, {});

    res.json({ totals, recent });
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: "이력을 불러오지 못했습니다" });
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

    const activeParty = user.party
      .map((uid) => user.pokemon.find((member) => member.uid === uid))
      .filter((member): member is NonNullable<typeof member> => Boolean(member));
    const evolutionPreview = getEvolutionBranchDiagnostics(pokemon.species, {
      level: pokemon.level,
      ...buildLevelEvolutionContext(pokemon, activeParty, {
        region: user.currentRegion ?? "default",
      }),
    }).map((branch) => ({
      ...branch,
      targetName: getSpeciesByName(branch.targetSpecies)?.name ?? branch.targetSpecies,
    }));

    res.json({ pokemon, evolutionPreview });
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

    const config = await getConfig();
    const catalog = Object.fromEntries(
      Object.keys(user.inventory).map((itemId) => [
        itemId,
        buildInventoryCatalogEntry(itemId, config.shop.items[itemId]),
      ]),
    );

    res.json({ inventory: user.inventory, catalog });
  } catch (err) {
    console.error("Inventory error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

gameRoutes.get("/trades", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const trades = await listTradesForUser(user.account.id);
    const views = await Promise.all(trades.map((trade) => buildTradeView(user.account.id, trade)));
    res.json({ trades: views });
  } catch (err) {
    console.error("Trade list error:", err);
    res.status(500).json({ error: "Failed to load trades." });
  }
});

gameRoutes.get("/trades/candidates/:userId", async (req: AuthRequest, res: Response) => {
  try {
    const candidates = await listTradeCandidates(req.userId!, req.params.userId);
    res.json(candidates);
  } catch (err) {
    if (err instanceof TradeError) {
      res.status(400).json({ error: err.message });
      return;
    }

    console.error("Trade candidates error:", err);
    res.status(500).json({ error: "Failed to load trade candidates." });
  }
});

gameRoutes.post("/trades/request", async (req: AuthRequest, res: Response) => {
  try {
    const { targetUserId, myPokemonUid, targetPokemonUid } = req.body ?? {};
    if (!targetUserId || !myPokemonUid || !targetPokemonUid) {
      res.status(400).json({ error: "targetUserId, myPokemonUid, and targetPokemonUid are required." });
      return;
    }

    const trade = await createTradeRequest({
      requesterUserId: req.userId!,
      responderUserId: String(targetUserId),
      requesterPokemonUid: String(myPokemonUid),
      responderPokemonUid: String(targetPokemonUid),
    });

    res.status(201).json({ trade: await buildTradeView(req.userId!, trade) });
  } catch (err) {
    if (err instanceof TradeError) {
      res.status(400).json({ error: err.message });
      return;
    }

    console.error("Trade request error:", err);
    res.status(500).json({ error: "Failed to create trade request." });
  }
});

gameRoutes.post("/trades/:id/accept", async (req: AuthRequest, res: Response) => {
  try {
    const result = await acceptTradeRequest(req.userId!, req.params.id);
    res.json({
      trade: await buildTradeView(req.userId!, result.trade),
      requesterPokemon: result.requesterPokemon,
      responderPokemon: result.responderPokemon,
      requesterEvolution: result.requesterEvolution,
      responderEvolution: result.responderEvolution,
    });
  } catch (err) {
    if (err instanceof TradeError) {
      res.status(400).json({ error: err.message });
      return;
    }

    console.error("Trade accept error:", err);
    res.status(500).json({ error: "Failed to accept trade request." });
  }
});

gameRoutes.post("/trades/:id/reject", async (req: AuthRequest, res: Response) => {
  try {
    const trade = await rejectTradeRequest(req.userId!, req.params.id);
    res.json({ trade: await buildTradeView(req.userId!, trade) });
  } catch (err) {
    if (err instanceof TradeError) {
      res.status(400).json({ error: err.message });
      return;
    }

    console.error("Trade reject error:", err);
    res.status(500).json({ error: "Failed to reject trade request." });
  }
});

gameRoutes.post("/trades/:id/cancel", async (req: AuthRequest, res: Response) => {
  try {
    const trade = await cancelTradeRequest(req.userId!, req.params.id);
    res.json({ trade: await buildTradeView(req.userId!, trade) });
  } catch (err) {
    if (err instanceof TradeError) {
      res.status(400).json({ error: err.message });
      return;
    }

    console.error("Trade cancel error:", err);
    res.status(500).json({ error: "Failed to cancel trade request." });
  }
});

gameRoutes.get("/regions", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.json({
      currentRegion: user.currentRegion ?? "default",
      regions: getRegionNames().map((regionId) => {
        const region = getRegion(regionId);
        return {
          id: regionId,
          name: region.name,
        };
      }),
    });
  } catch (err) {
    console.error("Region list error:", err);
    res.status(500).json({ error: "Failed to load regions." });
  }
});

gameRoutes.put("/region", async (req: AuthRequest, res: Response) => {
  try {
    const region = String(req.body.region ?? "").trim();
    if (!region) {
      res.status(400).json({ error: "region is required." });
      return;
    }
    if (!getRegionNames().includes(region)) {
      res.status(404).json({ error: "Region not found." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    user.currentRegion = region;
    await saveUser(user);

    res.json({
      currentRegion: region,
      regionName: getRegion(region).name,
    });
  } catch (err) {
    console.error("Region update error:", err);
    res.status(500).json({ error: "Failed to update region." });
  }
});

gameRoutes.get("/evolutions/pending", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const pending = (user.pendingEvolutions ?? []).map((entry) => ({
      ...entry,
      pokemon: user.pokemon.find((pokemon) => pokemon.uid === entry.pokemonUid)
        ?? user.storage.find((pokemon) => pokemon.uid === entry.pokemonUid)
        ?? null,
    }));

    res.json({ pending });
  } catch (err) {
    console.error("Pending evolutions error:", err);
    res.status(500).json({ error: "Failed to load pending evolutions." });
  }
});

gameRoutes.post("/evolutions/resolve", async (req: AuthRequest, res: Response) => {
  try {
    const { pendingEvolutionId, branchId } = req.body;
    if (!pendingEvolutionId || !branchId) {
      res.status(400).json({ error: "pendingEvolutionId and branchId are required." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const result = resolvePendingEvolutionChoice(user, pendingEvolutionId, branchId);
    await saveUser(user);

    res.json({
      message: `${result.pendingEvolution.sourceName} evolved into ${result.pokemon.species}.`,
      pokemon: result.pokemon,
      remainingPending: user.pendingEvolutions ?? [],
    });
  } catch (err) {
    if (err instanceof PendingEvolutionError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    console.error("Resolve evolution error:", err);
    res.status(500).json({ error: "Failed to resolve pending evolution." });
  }
});

gameRoutes.post("/items/equip", async (req: AuthRequest, res: Response) => {
  try {
    const { item, pokemonUid } = req.body;
    if (!item || !pokemonUid) {
      res.status(400).json({ error: "Item and pokemonUid are required." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const result = equipHeldItem(user, pokemonUid, item);
    await saveUser(user);

    res.json({
      message: `${result.pokemon.species} is now holding ${result.itemName}.`,
      pokemon: result.pokemon,
      previousHeldItem: result.previousHeldItem,
      inventory: user.inventory,
    });
  } catch (err) {
    if (err instanceof HeldItemError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    console.error("Equip held item error:", err);
    res.status(500).json({ error: "Failed to equip item." });
  }
});

gameRoutes.post("/items/unequip", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid } = req.body;
    if (!pokemonUid) {
      res.status(400).json({ error: "pokemonUid is required." });
      return;
    }

    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const result = unequipHeldItem(user, pokemonUid);
    await saveUser(user);

    res.json({
      message: `${result.pokemon.species} is no longer holding ${result.itemName}.`,
      pokemon: result.pokemon,
      inventory: user.inventory,
    });
  } catch (err) {
    if (err instanceof HeldItemError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    console.error("Unequip held item error:", err);
    res.status(500).json({ error: "Failed to unequip item." });
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

gameRoutes.get("/eggs", async (req: AuthRequest, res: Response) => {
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

gameRoutes.post("/eggs/buy", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    const tier = String(req.body.tier ?? "");
    const tierInfo = getEggTierSummaries().find((entry) => entry.tier === tier);
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
    user.eggs.push(egg);

    await saveUser(user);
    res.json({
      egg,
      cost: tierInfo.cost,
      remainingPoints: user.points,
    });
  } catch (err) {
    console.error("Egg buy error:", err);
    res.status(500).json({ error: "알 구매 중 오류가 발생했습니다" });
  }
});

gameRoutes.post("/eggs/hatch", async (req: AuthRequest, res: Response) => {
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
    res.json({
      egg: { id: egg.id, tier: egg.tier, label },
      pokemon,
      destination,
    });
  } catch (err) {
    console.error("Egg hatch error:", err);
    res.status(500).json({ error: "알 부화 중 오류가 발생했습니다" });
  }
});

function getLogSource(entry: Record<string, unknown>): string {
  if (entry.type === "integration_reward") {
    return String(entry.provider ?? "integration");
  }
  if (entry.type === "reward") {
    return "git";
  }
  return String(entry.type ?? "other");
}

function getLogSummary(entry: Record<string, unknown>): string {
  if (entry.type === "integration_reward") {
    return String(entry.summary ?? entry.eventKey ?? "integration reward");
  }
  if (entry.type === "reward") {
    const repo = String(entry.repo ?? "repo");
    const bytes = Number(entry.bytes ?? 0);
    return `${repo} / ${bytes} bytes`;
  }
  return String(entry.type ?? "activity");
}
