import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser } from "../storage/user-store.js";
import { GameRuleError } from "../game/game-errors.js";
import { getDisplaySpeciesName } from "../game/pokemon-state.js";
import {
  acceptTradeRequest,
  cancelTradeRequest,
  createTradeRequest,
  listTradeCandidates,
  listTradesForUser,
  rejectTradeRequest,
} from "../game/trade.js";
import { childLogger } from "../logger.js";

const log = childLogger("trade-routes");

export const tradeRoutes = Router();
tradeRoutes.use(authMiddleware);

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
      speciesName: requesterPokemon ? getDisplaySpeciesName(requesterPokemon.species) : null,
      isShiny: requesterPokemon?.isShiny ?? false,
    },
    responder: {
      userId: trade.responderUserId,
      nickname: responder?.account.nickname ?? trade.responderUserId,
      pokemonUid: trade.responderPokemonUid,
      species: responderPokemon?.species ?? null,
      speciesName: responderPokemon ? getDisplaySpeciesName(responderPokemon.species) : null,
      isShiny: responderPokemon?.isShiny ?? false,
    },
  };
}

tradeRoutes.get("/trades", async (req: AuthRequest, res: Response) => {
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
    log.error({ err }, "Trade list error");
    res.status(500).json({ error: "Failed to load trades." });
  }
});

tradeRoutes.get("/trades/candidates/:userId", async (req: AuthRequest, res: Response) => {
  try {
    const candidates = await listTradeCandidates(req.userId!, req.params.userId);
    res.json(candidates);
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(400).json({ error: err.message });
      return;
    }

    log.error({ err }, "Trade candidates error");
    res.status(500).json({ error: "Failed to load trade candidates." });
  }
});

tradeRoutes.post("/trades/request", async (req: AuthRequest, res: Response) => {
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
    if (err instanceof GameRuleError) {
      res.status(400).json({ error: err.message });
      return;
    }

    log.error({ err }, "Trade request error");
    res.status(500).json({ error: "Failed to create trade request." });
  }
});

tradeRoutes.post("/trades/:id/accept", async (req: AuthRequest, res: Response) => {
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
    if (err instanceof GameRuleError) {
      res.status(400).json({ error: err.message });
      return;
    }

    log.error({ err }, "Trade accept error");
    res.status(500).json({ error: "Failed to accept trade request." });
  }
});

tradeRoutes.post("/trades/:id/reject", async (req: AuthRequest, res: Response) => {
  try {
    const trade = await rejectTradeRequest(req.userId!, req.params.id);
    res.json({ trade: await buildTradeView(req.userId!, trade) });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(400).json({ error: err.message });
      return;
    }

    log.error({ err }, "Trade reject error");
    res.status(500).json({ error: "Failed to reject trade request." });
  }
});

tradeRoutes.post("/trades/:id/cancel", async (req: AuthRequest, res: Response) => {
  try {
    const trade = await cancelTradeRequest(req.userId!, req.params.id);
    res.json({ trade: await buildTradeView(req.userId!, trade) });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(400).json({ error: err.message });
      return;
    }

    log.error({ err }, "Trade cancel error");
    res.status(500).json({ error: "Failed to cancel trade request." });
  }
});
