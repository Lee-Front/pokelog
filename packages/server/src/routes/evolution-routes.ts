import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { resolvePendingEvolutionChoice } from "../game/pending-evolution.js";
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
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Resolve evolution error");
    res.status(500).json({ error: "Failed to resolve pending evolution." });
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
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    log.error({ err }, "Form change error");
    res.status(500).json({ error: "Failed to change form." });
  }
});
