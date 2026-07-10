import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withLock } from "../storage/pvp-store.js";
import { getSpeciesByName } from "../game/data-loader.js";
import {
  clearPendingEvolutionForPokemon,
  getAvailableEvolutionOptions,
  resolvePendingEvolutionChoice,
} from "../game/pending-evolution.js";
import { evolvePokemon } from "../game/growth.js";
import { applyFormChange, getAvailableForms, getFormChangeRules, hasFormChangeRules } from "../game/form-change.js";
import { GameRuleError } from "../game/game-errors.js";
import { buildStats } from "../game/pokemon-stats.js";
import { findPokemonByUid } from "../game/pokemon-state.js";
import { childLogger } from "../logger.js";
const log = childLogger("evolution-routes");


export const evolutionRoutes = Router();
evolutionRoutes.use(authMiddleware);

evolutionRoutes.get("/evolutions/pending", async (req: AuthRequest, res: Response) => {
  try {
    const user = await getUser(req.userId!);
    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const pending = (user.pendingEvolutions ?? []).map((entry) => ({
      ...entry,
      pokemon: findPokemonByUid(user, entry.pokemonUid) ?? null,
    }));

    res.json({ pending });
  } catch (err) {
    log.error({ err }, "Pending evolutions error");
    res.status(500).json({ error: "Failed to load pending evolutions." });
  }
});

evolutionRoutes.post("/evolutions/resolve", async (req: AuthRequest, res: Response) => {
  try {
    const { pendingEvolutionId, branchId } = req.body;
    if (!pendingEvolutionId || !branchId) {
      res.status(400).json({ error: "pendingEvolutionId and branchId are required." });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
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
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Resolve evolution error");
    res.status(500).json({ error: "Failed to resolve pending evolution." });
  }
});

// 온디맨드 진화 — 플레이어가 목록/상세에서 "지금 가능한" 진화지(branchId)를 골라 요청한다.
// 레벨업 자동 진화를 대체한다. getAvailableEvolutionOptions로 조건 충족을 재검증한 뒤 진화시키고,
// 연쇄진화 UX를 위해 진화 직후 다시 가능해진 옵션을 비영속으로 부착해 내려준다.
evolutionRoutes.post("/pokemon/:uid/evolve", async (req: AuthRequest, res: Response) => {
  try {
    const { branchId } = req.body ?? {};
    if (!branchId || typeof branchId !== "string") {
      res.status(400).json({ error: "branchId가 필요합니다." });
      return;
    }
    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) { res.status(404).json({ error: "사용자를 찾을 수 없습니다." }); return; }
      const pokemon = findPokemonByUid(user, req.params.uid);
      if (!pokemon) { res.status(404).json({ error: "포켓몬을 찾을 수 없습니다." }); return; }
      const region = user.currentRegion ?? "default";
      const options = getAvailableEvolutionOptions(user, pokemon, { region });
      const option = options.find((o) => o.branchId === branchId);
      if (!option) {
        throw new GameRuleError("진화 조건을 충족하지 않습니다.", 400);
      }
      const sourceName = getSpeciesByName(pokemon.species)?.name ?? pokemon.species;
      evolvePokemon(pokemon, option.targetSpecies, option.targetVariantId ?? null); // 스탯 재계산 포함
      if (!user.pokedex.includes(option.targetSpecies)) user.pokedex.push(option.targetSpecies);
      clearPendingEvolutionForPokemon(user, pokemon.uid); // 잔여 pending 정리
      await saveUser(user);
      // 연쇄진화 UX: 진화 후 다시 가능 옵션 계산해 비영속으로 부착
      const nextOptions = getAvailableEvolutionOptions(user, pokemon, { region });
      res.json({
        message: `${sourceName}이(가) ${option.targetName}(으)로 진화했습니다.`,
        pokemon: { ...pokemon, evolutionAvailable: nextOptions.length > 0, evolutionOptions: nextOptions },
      });
    });
  } catch (err) {
    if (err instanceof GameRuleError) { res.status(err.status).json({ error: err.message }); return; }
    log.error({ err }, "Evolve error");
    res.status(500).json({ error: "서버 오류가 발생했습니다" });
  }
});

evolutionRoutes.get("/form-change/rules/:species", async (req: AuthRequest, res: Response) => {
  try {
    const species = req.params.species;
    if (!hasFormChangeRules(species)) {
      res.status(404).json({ error: `${species} cannot change forms.` });
      return;
    }

    const forms = getAvailableForms(species);
    const rules = getFormChangeRules();
    const rule = rules[species];

    res.json({ species, rule, forms });
  } catch (err) {
    log.error({ err }, "Form change rules error");
    res.status(500).json({ error: "Failed to load form change rules." });
  }
});

evolutionRoutes.post("/form-change", async (req: AuthRequest, res: Response) => {
  try {
    const { pokemonUid, targetFormId } = req.body;
    if (!pokemonUid) {
      res.status(400).json({ error: "pokemonUid is required." });
      return;
    }

    await withLock(`user:${req.userId!}`, async () => {
      const user = await getUser(req.userId!);
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      const pokemon = findPokemonByUid(user, pokemonUid);

      if (!pokemon) {
        res.status(404).json({ error: "Pokemon not found." });
        return;
      }

      const result = applyFormChange(user, pokemonUid, targetFormId ?? null);

      // Recalculate stats with variant override
      const speciesData = getSpeciesByName(pokemon.species);
      if (speciesData) {
        const { maxHp, stats } = buildStats(speciesData, pokemon.level, pokemon.nature, pokemon.variantId, pokemon.ivs, pokemon.evs);
        const hpRatio = pokemon.maxHp > 0 ? pokemon.hp / pokemon.maxHp : 1;
        pokemon.maxHp = maxHp;
        pokemon.hp = Math.max(1, Math.round(maxHp * hpRatio));
        pokemon.stats = stats;
      }

      await saveUser(user);

      const formLabel = pokemon.variantId ?? pokemon.species;
      res.json({
        message: `${pokemon.species} changed to ${formLabel}.`,
        pokemon,
        previousVariantId: result.previousVariantId,
      });
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Form change error");
    res.status(500).json({ error: "Failed to change form." });
  }
});
