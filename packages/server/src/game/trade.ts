import type { OwnedPokemon, TradePokemonCandidate, TradeRecord, UserData } from "../../../../shared/types.js";
import { getUser, saveUser } from "../storage/user-store.js";
import { createTradeRecord, getTrades, saveTrades } from "../storage/trade-store.js";
import { GameRuleError } from "./game-errors.js";
import { evolvePokemon, resolveTradeEvolution } from "./growth.js";
import { getDisplaySpeciesName } from "./pokemon-state.js";

type PokemonSlot =
  | { container: "party"; index: number }
  | { container: "storage"; index: number };

export { GameRuleError as TradeError };

function clonePokemon(pokemon: OwnedPokemon): OwnedPokemon {
  return {
    ...pokemon,
    variantId: pokemon.variantId ?? null,
    stats: { ...pokemon.stats },
    moves: pokemon.moves.map((move) => ({ ...move })),
    moveUsageCounts: { ...(pokemon.moveUsageCounts ?? {}) },
    damageTakenTotal: pokemon.damageTakenTotal ?? 0,
  };
}

function findPokemon(user: UserData, uid: string): { pokemon: OwnedPokemon; slot: PokemonSlot } | null {
  const partyIndex = user.party.indexOf(uid);
  if (partyIndex !== -1) {
    const pokemonIndex = user.pokemon.findIndex((pokemon) => pokemon.uid === uid);
    if (pokemonIndex !== -1) {
      return { pokemon: user.pokemon[pokemonIndex], slot: { container: "party", index: partyIndex } };
    }
  }

  const storageIndex = user.storage.findIndex((pokemon) => pokemon.uid === uid);
  if (storageIndex !== -1) {
    return { pokemon: user.storage[storageIndex], slot: { container: "storage", index: storageIndex } };
  }

  return null;
}

function ensureTradeablePokemon(user: UserData, uid: string, ownerLabel: string) {
  const found = findPokemon(user, uid);
  if (!found) {
    throw new GameRuleError(`${ownerLabel} does not own the selected Pokemon.`);
  }

  if (user.battleState?.myPokemonUid === uid) {
    throw new GameRuleError(`${ownerLabel} cannot trade a Pokemon that is currently battling.`);
  }

  return found;
}

function listTradeablePokemon(user: UserData): TradePokemonCandidate[] {
  const battlingUid = user.battleState?.myPokemonUid ?? null;
  const candidates: TradePokemonCandidate[] = [];

  for (const uid of user.party) {
    if (uid === battlingUid) {
      continue;
    }

    const pokemon = user.pokemon.find((entry) => entry.uid === uid);
    if (!pokemon) {
      continue;
    }

    candidates.push({
      uid: pokemon.uid,
      species: pokemon.species,
      speciesName: getDisplaySpeciesName(pokemon.species),
      nickname: pokemon.nickname,
      level: pokemon.level,
      location: "party",
    });
  }

  for (const pokemon of user.storage) {
    if (pokemon.uid === battlingUid) {
      continue;
    }

    candidates.push({
      uid: pokemon.uid,
      species: pokemon.species,
      speciesName: getDisplaySpeciesName(pokemon.species),
      nickname: pokemon.nickname,
      level: pokemon.level,
      location: "storage",
    });
  }

  return candidates;
}

function removePokemon(user: UserData, uid: string): { pokemon: OwnedPokemon; slot: PokemonSlot } {
  const found = ensureTradeablePokemon(user, uid, "User");
  const pokemon = clonePokemon(found.pokemon);

  if (found.slot.container === "party") {
    user.pokemon = user.pokemon.filter((entry) => entry.uid !== uid);
    user.party.splice(found.slot.index, 1);
  } else {
    user.storage.splice(found.slot.index, 1);
  }

  return { pokemon, slot: found.slot };
}

function insertPokemon(user: UserData, pokemon: OwnedPokemon, slot: PokemonSlot) {
  if (slot.container === "party") {
    user.pokemon.push(pokemon);
    user.party.splice(Math.min(slot.index, user.party.length), 0, pokemon.uid);
    return;
  }

  user.storage.push(pokemon);
}

function maybeApplyTradeEvolution(
  user: UserData,
  pokemon: OwnedPokemon,
  tradePartnerSpecies: string,
): { evolved: boolean; fromSpecies: string; toSpecies: string } {
  const branch = resolveTradeEvolution(pokemon.species, {
    heldItem: pokemon.heldItem ?? null,
    tradePartnerSpecies,
  });

  if (!branch) {
    return {
      evolved: false,
      fromSpecies: pokemon.species,
      toSpecies: pokemon.species,
    };
  }

  const fromSpecies = pokemon.species;
  evolvePokemon(pokemon, branch.targetSpecies, branch.targetVariantId);

  if (branch.conditions.some((condition) => condition.type === "held-item")) {
    pokemon.heldItem = null;
  }

  if (!user.pokedex.includes(pokemon.species)) {
    user.pokedex.push(pokemon.species);
  }

  return {
    evolved: true,
    fromSpecies,
    toSpecies: pokemon.species,
  };
}

function getTradeById(trades: TradeRecord[], tradeId: string): TradeRecord {
  const trade = trades.find((entry) => entry.id === tradeId);
  if (!trade) {
    throw new GameRuleError("Trade request not found.");
  }
  return trade;
}

export async function listTradesForUser(userId: string): Promise<TradeRecord[]> {
  const trades = await getTrades();
  return trades.filter((trade) => trade.requesterUserId === userId || trade.responderUserId === userId);
}

export async function listTradeCandidates(requesterUserId: string, responderUserId: string): Promise<{
  requester: { userId: string; nickname: string; pokemon: TradePokemonCandidate[] };
  responder: { userId: string; nickname: string; pokemon: TradePokemonCandidate[] };
}> {
  if (requesterUserId === responderUserId) {
    throw new GameRuleError("You cannot trade with yourself.");
  }

  const [requester, responder] = await Promise.all([
    getUser(requesterUserId),
    getUser(responderUserId),
  ]);

  if (!requester || !responder) {
    throw new GameRuleError("Both users must exist before trade candidates can be listed.");
  }

  return {
    requester: {
      userId: requester.account.id,
      nickname: requester.account.nickname,
      pokemon: listTradeablePokemon(requester),
    },
    responder: {
      userId: responder.account.id,
      nickname: responder.account.nickname,
      pokemon: listTradeablePokemon(responder),
    },
  };
}

export async function createTradeRequest(input: {
  requesterUserId: string;
  responderUserId: string;
  requesterPokemonUid: string;
  responderPokemonUid: string;
}): Promise<TradeRecord> {
  if (input.requesterUserId === input.responderUserId) {
    throw new GameRuleError("You cannot trade with yourself.");
  }

  const [requester, responder, trades] = await Promise.all([
    getUser(input.requesterUserId),
    getUser(input.responderUserId),
    getTrades(),
  ]);

  if (!requester || !responder) {
    throw new GameRuleError("Both users must exist before a trade can be requested.");
  }

  ensureTradeablePokemon(requester, input.requesterPokemonUid, "Requester");
  ensureTradeablePokemon(responder, input.responderPokemonUid, "Responder");

  const duplicatePending = trades.find((trade) => (
    trade.status === "pending"
    && trade.requesterUserId === input.requesterUserId
    && trade.responderUserId === input.responderUserId
    && trade.requesterPokemonUid === input.requesterPokemonUid
    && trade.responderPokemonUid === input.responderPokemonUid
  ));

  if (duplicatePending) {
    throw new GameRuleError("An identical pending trade request already exists.");
  }

  const trade = createTradeRecord(input);
  trades.push(trade);
  await saveTrades(trades);
  return trade;
}

export async function cancelTradeRequest(userId: string, tradeId: string): Promise<TradeRecord> {
  const trades = await getTrades();
  const trade = getTradeById(trades, tradeId);

  if (trade.requesterUserId !== userId) {
    throw new GameRuleError("Only the requester can cancel this trade.");
  }

  if (trade.status !== "pending") {
    throw new GameRuleError("Only pending trades can be cancelled.");
  }

  trade.status = "cancelled";
  trade.updatedAt = new Date().toISOString();
  trade.resolvedAt = trade.updatedAt;
  await saveTrades(trades);
  return trade;
}

export async function rejectTradeRequest(userId: string, tradeId: string): Promise<TradeRecord> {
  const trades = await getTrades();
  const trade = getTradeById(trades, tradeId);

  if (trade.responderUserId !== userId) {
    throw new GameRuleError("Only the target user can reject this trade.");
  }

  if (trade.status !== "pending") {
    throw new GameRuleError("Only pending trades can be rejected.");
  }

  trade.status = "rejected";
  trade.updatedAt = new Date().toISOString();
  trade.resolvedAt = trade.updatedAt;
  await saveTrades(trades);
  return trade;
}

export async function acceptTradeRequest(userId: string, tradeId: string): Promise<{
  trade: TradeRecord;
  requesterPokemon: OwnedPokemon;
  responderPokemon: OwnedPokemon;
  requesterEvolution: { evolved: boolean; fromSpecies: string; toSpecies: string };
  responderEvolution: { evolved: boolean; fromSpecies: string; toSpecies: string };
}> {
  const trades = await getTrades();
  const trade = getTradeById(trades, tradeId);

  if (trade.responderUserId !== userId) {
    throw new GameRuleError("Only the target user can accept this trade.");
  }

  if (trade.status !== "pending") {
    throw new GameRuleError("Only pending trades can be accepted.");
  }

  const [requester, responder] = await Promise.all([
    getUser(trade.requesterUserId),
    getUser(trade.responderUserId),
  ]);

  if (!requester || !responder) {
    throw new GameRuleError("Both users must exist before a trade can be completed.");
  }

  const requesterFound = ensureTradeablePokemon(requester, trade.requesterPokemonUid, "Requester");
  const responderFound = ensureTradeablePokemon(responder, trade.responderPokemonUid, "Responder");
  const requesterOriginalSpecies = requesterFound.pokemon.species;
  const responderOriginalSpecies = responderFound.pokemon.species;

  const requesterRemoved = removePokemon(requester, trade.requesterPokemonUid);
  const responderRemoved = removePokemon(responder, trade.responderPokemonUid);

  insertPokemon(requester, responderRemoved.pokemon, requesterRemoved.slot);
  insertPokemon(responder, requesterRemoved.pokemon, responderRemoved.slot);

  const requesterReceived = ensureTradeablePokemon(requester, responderRemoved.pokemon.uid, "Requester").pokemon;
  const responderReceived = ensureTradeablePokemon(responder, requesterRemoved.pokemon.uid, "Responder").pokemon;

  const requesterEvolution = maybeApplyTradeEvolution(requester, requesterReceived, requesterOriginalSpecies);
  const responderEvolution = maybeApplyTradeEvolution(responder, responderReceived, responderOriginalSpecies);

  if (!requester.pokedex.includes(requesterReceived.species)) {
    requester.pokedex.push(requesterReceived.species);
  }
  if (!responder.pokedex.includes(responderReceived.species)) {
    responder.pokedex.push(responderReceived.species);
  }

  trade.status = "accepted";
  trade.updatedAt = new Date().toISOString();
  trade.resolvedAt = trade.updatedAt;

  await Promise.all([
    saveUser(requester),
    saveUser(responder),
    saveTrades(trades),
  ]);

  return {
    trade,
    requesterPokemon: requesterReceived,
    responderPokemon: responderReceived,
    requesterEvolution,
    responderEvolution,
  };
}
