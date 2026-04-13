import { apiGet, apiPost } from "../api-client.js";
import { rawSelect } from "../ui/prompts.js";

type TradeView = {
  id: string;
  status: string;
  direction: "incoming" | "outgoing";
  requester: {
    userId: string;
    nickname: string;
    pokemonUid: string;
    species: string | null;
    speciesName: string | null;
  };
  responder: {
    userId: string;
    nickname: string;
    pokemonUid: string;
    species: string | null;
    speciesName: string | null;
  };
};

type TradeUserSearchResult = {
  id: string;
  nickname: string;
};

type TradePokemonCandidate = {
  uid: string;
  species: string;
  speciesName: string;
  nickname: string | null;
  level: number;
  location: "party" | "storage";
};

type TradeCandidatesResponse = {
  requester: {
    userId: string;
    nickname: string;
    pokemon: TradePokemonCandidate[];
  };
  responder: {
    userId: string;
    nickname: string;
    pokemon: TradePokemonCandidate[];
  };
};

function formatTradeLine(trade: TradeView): string {
  const left = `${trade.requester.nickname} [${trade.requester.userId}]`;
  const right = `${trade.responder.nickname} [${trade.responder.userId}]`;
  const leftPokemon = trade.requester.speciesName ?? trade.requester.species ?? trade.requester.pokemonUid;
  const rightPokemon = trade.responder.speciesName ?? trade.responder.species ?? trade.responder.pokemonUid;
  return `${trade.id} | ${trade.status} | ${trade.direction} | ${leftPokemon} <-> ${rightPokemon} | ${left} -> ${right}`;
}

export async function tradeCommand() {
  const response = await apiGet("/api/game/trades");
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  const trades = (response.data.trades ?? []) as TradeView[];
  if (trades.length === 0) {
    console.log("No trades.");
    return;
  }

  for (const trade of trades) {
    console.log(formatTradeLine(trade));
  }
}

export async function tradeSearchCommand(query: string) {
  const response = await apiGet(`/api/user/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  const users = (response.data.users ?? []) as TradeUserSearchResult[];
  if (users.length === 0) {
    console.log("No matching users.");
    return;
  }

  for (const user of users) {
    console.log(`${user.id.padEnd(16)} ${user.nickname}`);
  }
}

async function resolveTargetUserId(query: string): Promise<string | null> {
  const response = await apiGet(`/api/user/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return null;
  }

  const users = (response.data.users ?? []) as TradeUserSearchResult[];
  if (users.length === 0) {
    console.log("No matching users.");
    return null;
  }

  if (users.length === 1) {
    return users[0].id;
  }

  const exact = users.find((user) => user.id === query);
  if (exact) {
    return exact.id;
  }

  const selected = await rawSelect(
    "Choose a trade target",
    [
      ...users.map((user) => ({
        name: `${user.nickname} (${user.id})`,
        value: user.id,
      })),
      { name: "Cancel", value: "__cancel__" },
    ],
  );

  if (!selected || selected === "__cancel__") {
    return null;
  }

  return selected;
}

function formatTradePokemonCandidate(candidate: TradePokemonCandidate): string {
  const name = candidate.nickname
    ? `${candidate.nickname} (${candidate.speciesName})`
    : candidate.speciesName;
  const location = candidate.location === "party" ? "Party" : "Storage";
  return `${name} | Lv.${candidate.level} | ${location} | ${candidate.uid}`;
}

async function chooseTradePokemon(
  message: string,
  candidates: TradePokemonCandidate[],
  requestedUid?: string,
): Promise<string | null> {
  if (candidates.length === 0) {
    console.log("No tradeable Pokemon available.");
    return null;
  }

  if (requestedUid) {
    const exact = candidates.find((candidate) => candidate.uid === requestedUid);
    if (!exact) {
      console.log(`Pokemon not found or not tradeable: ${requestedUid}`);
      return null;
    }
    return exact.uid;
  }

  if (candidates.length === 1) {
    return candidates[0].uid;
  }

  const selected = await rawSelect(
    message,
    [
      ...candidates.map((candidate) => ({
        name: formatTradePokemonCandidate(candidate),
        value: candidate.uid,
      })),
      { name: "Cancel", value: "__cancel__" },
    ],
  );

  if (!selected || selected === "__cancel__") {
    return null;
  }

  return selected;
}

export async function tradeRequestCommand(
  targetUserQuery: string,
  myPokemonUid?: string,
  targetPokemonUid?: string,
) {
  const targetUserId = await resolveTargetUserId(targetUserQuery);
  if (!targetUserId) {
    return;
  }

  const candidatesResponse = await apiGet(`/api/game/trades/candidates/${encodeURIComponent(targetUserId)}`);
  if (!candidatesResponse.ok) {
    console.error(`Error: ${candidatesResponse.data.error}`);
    return;
  }

  const candidates = candidatesResponse.data as TradeCandidatesResponse;
  const resolvedMyPokemonUid = await chooseTradePokemon(
    `Choose your Pokemon for ${candidates.responder.nickname}`,
    candidates.requester.pokemon,
    myPokemonUid,
  );
  if (!resolvedMyPokemonUid) {
    return;
  }

  const resolvedTargetPokemonUid = await chooseTradePokemon(
    `Choose ${candidates.responder.nickname}'s Pokemon to request`,
    candidates.responder.pokemon,
    targetPokemonUid,
  );
  if (!resolvedTargetPokemonUid) {
    return;
  }

  const response = await apiPost("/api/game/trades/request", {
    targetUserId,
    myPokemonUid: resolvedMyPokemonUid,
    targetPokemonUid: resolvedTargetPokemonUid,
  });

  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  const trade = response.data.trade as TradeView;
  console.log(`Trade created: ${formatTradeLine(trade)}`);
}

export async function tradeAcceptCommand(tradeId: string) {
  const response = await apiPost(`/api/game/trades/${tradeId}/accept`);
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  const trade = response.data.trade as TradeView;
  console.log(`Trade accepted: ${formatTradeLine(trade)}`);
}

export async function tradeRejectCommand(tradeId: string) {
  const response = await apiPost(`/api/game/trades/${tradeId}/reject`);
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  const trade = response.data.trade as TradeView;
  console.log(`Trade rejected: ${formatTradeLine(trade)}`);
}

export async function tradeCancelCommand(tradeId: string) {
  const response = await apiPost(`/api/game/trades/${tradeId}/cancel`);
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  const trade = response.data.trade as TradeView;
  console.log(`Trade cancelled: ${formatTradeLine(trade)}`);
}

export async function tradeLockCommand(pokemonUid: string) {
  const response = await apiPost("/api/game/trades/lock", { pokemonUid });
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  console.log(response.data.message ?? "Pokemon trade-locked.");
}

export async function tradeUnlockCommand(pokemonUid: string) {
  const response = await apiPost("/api/game/trades/unlock", { pokemonUid });
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return;
  }

  console.log(response.data.message ?? "Pokemon trade lock removed.");
}
