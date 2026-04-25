import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { withUserLock } from "../storage/user-mutex.js";
import { getSpeciesByName } from "../game/data-loader.js";
import { resolvePendingEvolutionChoice } from "../game/pending-evolution.js";
import { applyFormChange, getAvailableForms, getFormChangeRules, hasFormChangeRules } from "../game/form-change.js";
import { GameRuleError } from "../game/game-errors.js";
import { buildStats } from "../game/pokemon-stats.js";
import { findPokemonByUid } from "../game/pokemon-state.js";

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
    console.error("Pending evolutions error:", err);
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

    type Outcome =
      | { kind: "ok"; result: ReturnType<typeof resolvePendingEvolutionChoice>; remainingPending: unknown }
      | { kind: "not_found" }
      | { kind: "game_error"; err: GameRuleError };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };

      try {
        const result = resolvePendingEvolutionChoice(user, pendingEvolutionId, branchId);
        await saveUser(user);
        return { kind: "ok", result, remainingPending: user.pendingEvolutions ?? [] };
      } catch (err) {
        if (err instanceof GameRuleError) return { kind: "game_error", err };
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
      message: `${outcome.result.pendingEvolution.sourceName} evolved into ${outcome.result.pokemon.species}.`,
      pokemon: outcome.result.pokemon,
      remainingPending: outcome.remainingPending,
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    console.error("Resolve evolution error:", err);
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
    console.error("Form change rules error:", err);
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

    type Outcome =
      | { kind: "ok"; pokemon: ReturnType<typeof findPokemonByUid>; previousVariantId: string | null | undefined; speciesLabel: string; formLabel: string }
      | { kind: "not_found" }
      | { kind: "pokemon_missing" }
      | { kind: "game_error"; err: GameRuleError };

    const outcome = await withUserLock<Outcome>(req.userId!, async () => {
      const user = await getUser(req.userId!);
      if (!user) return { kind: "not_found" };

      const pokemon = findPokemonByUid(user, pokemonUid);
      if (!pokemon) return { kind: "pokemon_missing" };

      try {
        const result = applyFormChange(user, pokemonUid, targetFormId ?? null);

        // Recalculate stats with variant override
        const speciesData = getSpeciesByName(pokemon.species);
        if (speciesData) {
          const { maxHp, stats } = buildStats(speciesData, pokemon.level, pokemon.nature, pokemon.variantId, pokemon.ivs);
          const hpRatio = pokemon.maxHp > 0 ? pokemon.hp / pokemon.maxHp : 1;
          pokemon.maxHp = maxHp;
          pokemon.hp = Math.max(1, Math.round(maxHp * hpRatio));
          pokemon.stats = stats;
        }

        await saveUser(user);

        const formLabel = pokemon.variantId ?? pokemon.species;
        return {
          kind: "ok",
          pokemon,
          previousVariantId: result.previousVariantId,
          speciesLabel: pokemon.species,
          formLabel,
        };
      } catch (err) {
        if (err instanceof GameRuleError) return { kind: "game_error", err };
        throw err;
      }
    });

    if (outcome.kind === "not_found") {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (outcome.kind === "pokemon_missing") {
      res.status(404).json({ error: "Pokemon not found." });
      return;
    }
    if (outcome.kind === "game_error") {
      res.status(outcome.err.status).json({ error: outcome.err.message });
      return;
    }

    res.json({
      message: `${outcome.speciesLabel} changed to ${outcome.formLabel}.`,
      pokemon: outcome.pokemon,
      previousVariantId: outcome.previousVariantId,
    });
  } catch (err) {
    if (err instanceof GameRuleError) {
      res.status(err.status).json({ error: err.message });
      return;
    }

    console.error("Form change error:", err);
    res.status(500).json({ error: "Failed to change form." });
  }
});
