import { Router } from "express";
import type { Response } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth-middleware.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { getConfig } from "../storage/config-store.js";
import { getAllSpecies } from "../game/pokemon-factory.js";
import { getRegion, getRegionNames, getSpeciesByName } from "../game/data-loader.js";
import { healPokemon } from "../game/inventory-utils.js";
import { equipHeldItem, unequipHeldItem } from "../game/held-item-usage.js";
import { buildInventoryCatalogEntry } from "../game/inventory-catalog.js";
import { resolvePendingEvolutionChoice } from "../game/pending-evolution.js";
import { buildLevelEvolutionContext, getEvolutionBranchDiagnostics } from "../game/growth.js";
import { applyFormChange, getAvailableForms, getFormChangeRules, hasFormChangeRules } from "../game/form-change.js";
import { GameRuleError } from "../game/game-errors.js";
import { buildStats } from "../game/pokemon-stats.js";
import { findPokemonByUid, getPartyPokemon } from "../game/pokemon-state.js";
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

    const partyPokemon = getPartyPokemon(user);

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

    const pokemon = findPokemonByUid(user, req.params.uid);

    if (!pokemon) {
      res.status(404).json({ error: "포켓몬을 찾을 수 없습니다" });
      return;
    }

    const activeParty = getPartyPokemon(user);
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
      pokemon: findPokemonByUid(user, entry.pokemonUid) ?? null,
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
    if (err instanceof GameRuleError) {
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
    if (err instanceof GameRuleError) {
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
    if (err instanceof GameRuleError) {
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

    const partyPokemon = getPartyPokemon(user);

    for (const p of partyPokemon) {
      healPokemon(p);
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

gameRoutes.get("/form-change/rules/:species", async (req: AuthRequest, res: Response) => {
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

gameRoutes.post("/form-change", async (req: AuthRequest, res: Response) => {
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
      const { maxHp, stats } = buildStats(speciesData, pokemon.level, pokemon.nature, pokemon.variantId);
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

    console.error("Form change error:", err);
    res.status(500).json({ error: "Failed to change form." });
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
