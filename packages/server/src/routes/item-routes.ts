import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { healPokemon } from "../game/inventory-utils.js";
import { equipHeldItem, unequipHeldItem } from "../game/held-item-usage.js";
import { buildInventoryCatalogEntry } from "../game/inventory-catalog.js";
import { GameRuleError } from "../game/game-errors.js";
import { getPartyPokemon } from "../game/pokemon-state.js";
import { withUserLock } from "../storage/user-mutex.js";
import { learnPendingMove, useTmOnPokemon } from "../game/item-usage.js";
import { VALID_TERA_TYPES } from "../../../../shared/constants.js";

export const itemRoutes = Router();
itemRoutes.use(authMiddleware);

itemRoutes.get("/inventory", async (req: AuthRequest, res: Response) => {
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

itemRoutes.post("/items/equip", async (req: AuthRequest, res: Response) => {
  try {
    const { item, pokemonUid } = req.body;
    if (!item || !pokemonUid) {
      res.status(400).json({ error: "Item and pokemonUid are required." });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" as const };
      try {
        const result = equipHeldItem(user, pokemonUid, item);
        await saveUser(user);
        return { kind: "ok" as const, result, inventory: user.inventory };
      } catch (err) {
        if (err instanceof GameRuleError) return { kind: "game_error" as const, err };
        throw err;
      }
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (outcome.kind === "game_error") {
      res.status(outcome.err.status).json({ error: outcome.err.message });
      return;
    }

    res.json({
      message: `${outcome.result.pokemon.species} is now holding ${outcome.result.itemName}.`,
      pokemon: outcome.result.pokemon,
      previousHeldItem: outcome.result.previousHeldItem,
      inventory: outcome.inventory,
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    console.error("Equip held item error:", err);
    res.status(500).json({ error: "Failed to equip item." });
  }
});

itemRoutes.post("/items/unequip", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid } = req.body;
    if (!pokemonUid) {
      res.status(400).json({ error: "pokemonUid is required." });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" as const };
      try {
        const result = unequipHeldItem(user, pokemonUid);
        await saveUser(user);
        return { kind: "ok" as const, result, inventory: user.inventory };
      } catch (err) {
        if (err instanceof GameRuleError) return { kind: "game_error" as const, err };
        throw err;
      }
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (outcome.kind === "game_error") {
      res.status(outcome.err.status).json({ error: outcome.err.message });
      return;
    }

    res.json({
      message: `${outcome.result.pokemon.species} is no longer holding ${outcome.result.itemName}.`,
      pokemon: outcome.result.pokemon,
      inventory: outcome.inventory,
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    console.error("Unequip held item error:", err);
    res.status(500).json({ error: "Failed to unequip item." });
  }
});

const TERA_SHARD_COST = 50;

itemRoutes.post("/change-tera-type", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid, teraType } = req.body ?? {};
    if (!pokemonUid || typeof teraType !== "string") {
      res.status(400).json({ error: "pokemonUid와 teraType이 필요합니다" });
      return;
    }
    if (!VALID_TERA_TYPES.has(teraType)) {
      res.status(400).json({ error: "유효하지 않은 테라 타입입니다" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };

      const poke =
        user.pokemon.find((p) => p.uid === pokemonUid) ??
        user.storage.find((p) => p.uid === pokemonUid);
      if (!poke) return { kind: "no_pokemon" as const };

      const shardId = `tera-shard-${teraType}`;
      const owned = user.inventory[shardId] ?? 0;
      if (owned < TERA_SHARD_COST) {
        return { kind: "insufficient" as const, shardId };
      }

      user.inventory[shardId] = owned - TERA_SHARD_COST;
      if (user.inventory[shardId] <= 0) {
        delete user.inventory[shardId];
      }
      poke.teraType = teraType;
      await saveUser(user);
      return { kind: "ok" as const, pokemon: poke, inventory: user.inventory };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "no_pokemon") {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "insufficient") {
      res.status(400).json({
        error: `${outcome.shardId}이(가) ${TERA_SHARD_COST}개 필요합니다`,
      });
      return;
    }

    res.json({ pokemon: outcome.pokemon, inventory: outcome.inventory });
  } catch (err) {
    console.error("Change tera type error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

/**
 * Teach a TM move. Body: { pokemonUid, tmItemId, forgetMoveId? }.
 * If the pokemon has 4 moves and no forgetMoveId is given, returns
 * 200 with `needsForgetMove=true` and the current move ids so the
 * client can prompt the user. The TM is NOT consumed in that case.
 */
itemRoutes.post("/learn-tm", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid, tmItemId, forgetMoveId } = req.body ?? {};
    if (typeof pokemonUid !== "string" || typeof tmItemId !== "string") {
      res.status(400).json({ error: "pokemonUid와 tmItemId가 필요합니다" });
      return;
    }
    if (forgetMoveId !== undefined && typeof forgetMoveId !== "string") {
      res.status(400).json({ error: "forgetMoveId가 올바르지 않습니다" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };
      const result = useTmOnPokemon(user, pokemonUid, tmItemId, forgetMoveId);
      // Persist on success — we don't want to write the user file when
      // we just bounce the request asking for a forgetMoveId.
      if (result.ok) {
        await saveUser(user);
      }
      const pokemon = user.pokemon.find((p) => p.uid === pokemonUid)
        ?? user.storage.find((p) => p.uid === pokemonUid);
      return { kind: "ok" as const, result, pokemon, inventory: user.inventory };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    if (!outcome.result.ok && !outcome.result.needsForgetMove) {
      res.status(400).json({ error: outcome.result.error ?? "TM 사용에 실패했습니다" });
      return;
    }

    res.json({
      ok: outcome.result.ok,
      needsForgetMove: outcome.result.needsForgetMove ?? false,
      currentMoves: outcome.result.currentMoves,
      learned: outcome.result.learned,
      pokemon: outcome.pokemon,
      inventory: outcome.inventory,
    });
  } catch (err) {
    console.error("Learn TM error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

/**
 * Resolve a pending level-up move. Body: { pokemonUid, forgetMoveId? }.
 * If forgetMoveId is omitted/null, the queued move is discarded
 * (declined). Otherwise the named slot is replaced with the pending
 * move.
 */
itemRoutes.post("/pokemon/:uid/learn-pending", async (req: AuthRequest, res: Response) => {
  try {
    const { forgetMoveId } = req.body ?? {};
    if (forgetMoveId !== undefined && forgetMoveId !== null && typeof forgetMoveId !== "string") {
      res.status(400).json({ error: "forgetMoveId가 올바르지 않습니다" });
      return;
    }

    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };
      const pokemon = user.pokemon.find((p) => p.uid === req.params.uid)
        ?? user.storage.find((p) => p.uid === req.params.uid);
      if (!pokemon) return { kind: "no_pokemon" as const };
      const result = learnPendingMove(pokemon, forgetMoveId ?? null);
      if (result.ok) {
        await saveUser(user);
      }
      return { kind: "ok" as const, result, pokemon };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }
    if (outcome.kind === "no_pokemon") {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }
    if (!outcome.result.ok) {
      res.status(400).json({ error: outcome.result.error ?? "기술 학습에 실패했습니다" });
      return;
    }

    res.json({
      ok: true,
      learned: outcome.result.learned,
      forgot: outcome.result.forgot,
      pokemon: outcome.pokemon,
    });
  } catch (err) {
    console.error("Learn pending error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

itemRoutes.post("/heal", async (req: AuthRequest, res: Response) => {
  try {
    const outcome = await withUserLock(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "no_user" as const };

      const partyPokemon = getPartyPokemon(user);

      for (const p of partyPokemon) {
        healPokemon(p);
      }

      await saveUser(user);
      return { kind: "ok" as const, count: partyPokemon.length };
    });

    if (outcome.kind === "no_user") {
      res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
      return;
    }

    res.json({ healed: outcome.count });
  } catch (err) {
    console.error("Heal error:", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});
