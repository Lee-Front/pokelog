import { apiGet, apiPost } from "../api-client.js";
import { separator, inputPrompt } from "../ui/prompts.js";
import {
  formatTradeLine,
  formatTradeItem,
  formatCandidateLine,
  type TradeView,
  type TradePokemonCandidate,
} from "../logic/trade.js";
import { DIM, GRN, RED, R, YEL } from "../ui/colors.js";
import { confirmFrame, formatScreenMessage, runMenuLoop, selectFrame, type ScreenMessage } from "../ui/screen.js";

type TradeUserSearchResult = {
  id: string;
  nickname: string;
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

type TradeActionResult = {
  ok: boolean;
  message: string;
};

async function requestTrade(
  targetUserQuery: string,
  myPokemonUid?: string,
  targetPokemonUid?: string,
): Promise<TradeActionResult> {
  const targetUserId = await resolveTargetUserId(targetUserQuery);
  if (!targetUserId) {
    return { ok: false, message: "Trade target not selected." };
  }

  const candidatesResponse = await apiGet(`/api/game/trades/candidates/${encodeURIComponent(targetUserId)}`);
  if (!candidatesResponse.ok) {
    return { ok: false, message: String(candidatesResponse.data.error) };
  }

  const candidates = candidatesResponse.data as TradeCandidatesResponse;
  const resolvedMyPokemonUid = await chooseTradePokemon(
    `Choose your Pokemon for ${candidates.responder.nickname}`,
    candidates.requester.pokemon,
    myPokemonUid,
  );
  if (!resolvedMyPokemonUid) {
    return { ok: false, message: "Your Pokemon was not selected." };
  }

  const resolvedTargetPokemonUid = await chooseTradePokemon(
    `Choose ${candidates.responder.nickname}'s Pokemon to request`,
    candidates.responder.pokemon,
    targetPokemonUid,
  );
  if (!resolvedTargetPokemonUid) {
    return { ok: false, message: "Target Pokemon was not selected." };
  }

  const response = await apiPost("/api/game/trades/request", {
    targetUserId,
    myPokemonUid: resolvedMyPokemonUid,
    targetPokemonUid: resolvedTargetPokemonUid,
  });

  if (!response.ok) {
    return { ok: false, message: String(response.data.error) };
  }

  const trade = response.data.trade as TradeView;
  return { ok: true, message: `Trade created: ${formatTradeLine(trade)}` };
}

async function acceptTrade(tradeId: string): Promise<TradeActionResult> {
  const response = await apiPost(`/api/game/trades/${tradeId}/accept`);
  if (!response.ok) {
    return { ok: false, message: String(response.data.error) };
  }

  const trade = response.data.trade as TradeView;
  return { ok: true, message: `Trade accepted: ${formatTradeLine(trade)}` };
}

async function rejectTrade(tradeId: string): Promise<TradeActionResult> {
  const response = await apiPost(`/api/game/trades/${tradeId}/reject`);
  if (!response.ok) {
    return { ok: false, message: String(response.data.error) };
  }

  const trade = response.data.trade as TradeView;
  return { ok: true, message: `Trade rejected: ${formatTradeLine(trade)}` };
}

async function cancelTrade(tradeId: string): Promise<TradeActionResult> {
  const response = await apiPost(`/api/game/trades/${tradeId}/cancel`);
  if (!response.ok) {
    return { ok: false, message: String(response.data.error) };
  }

  const trade = response.data.trade as TradeView;
  return { ok: true, message: `Trade cancelled: ${formatTradeLine(trade)}` };
}

export async function tradeCommand() {
  type TradeScreenState = { message: ScreenMessage | null };

  try {
    await runMenuLoop<TradeScreenState, TradeView[], string>({
      initialState: { message: null },
      pageSize: 16,
      load: async () => {
        const response = await apiGet("/api/game/trades");
        if (!response.ok) {
          throw new Error(String(response.data.error));
        }
        return (response.data.trades ?? []) as TradeView[];
      },
      prompt: () => "Trade menu",
      items: (trades, state) => {
        const items: Array<{ name: string; value: string } | { separator: string }> = [];

        if (trades.length > 0) {
          const pending = trades.filter((trade) => trade.status === "pending");
          const resolved = trades.filter((trade) => trade.status !== "pending");

          if (pending.length > 0) {
            items.push(separator(`  ${YEL}Pending${R}`));
            for (const trade of pending) {
              items.push({ name: `  ${formatTradeItem(trade)}`, value: `trade:${trade.id}` });
            }
          }

          if (resolved.length > 0) {
            items.push(separator(`  ${DIM}Resolved${R}`));
            for (const trade of resolved.slice(0, 10)) {
              items.push({ name: `  ${DIM}${formatTradeItem(trade)}${R}`, value: `resolved:${trade.id}` });
            }
          }
        } else {
          items.push(separator(`  ${DIM}No trades yet${R}`));
        }

        if (state.message) {
          items.push(separator(" "));
          items.push(separator(`  ${formatScreenMessage(state.message)}`));
        }

        items.push(separator(" "));
        items.push({ name: "  New trade request", value: "__new__" });
        items.push({ name: "  Close", value: "__back__" });
        return items;
      },
      onSelect: async (choice, trades, state) => {
        if (choice === "__back__") {
          return { state, close: true };
        }

        if (choice === "__new__") {
          const query = await inputPrompt("Trade target nickname or user ID:");
          if (!query) {
            return state;
          }
          const result = await requestTrade(query);
          return { message: { tone: result.ok ? "success" : "error", text: result.message } };
        }

        if (choice.startsWith("resolved:")) {
          return state;
        }

        if (!choice.startsWith("trade:")) {
          return state;
        }

        const tradeId = choice.slice(6);
        const trade = trades.find((entry) => entry.id === tradeId);
        if (!trade) {
          return state;
        }

        const actionItems: Array<{ name: string; value: string }> = [];
        if (trade.direction === "incoming") {
          actionItems.push({ name: `${GRN}Accept${R}`, value: "accept" });
          actionItems.push({ name: `${RED}Reject${R}`, value: "reject" });
        } else {
          actionItems.push({ name: `${RED}Cancel${R}`, value: "cancel" });
        }
        actionItems.push({ name: "Back", value: "__back__" });

        const action = await selectFrame(formatTradeItem(trade), actionItems);
        if (!action || action === "__back__") {
          return state;
        }

        if (action === "accept") {
          const confirmed = await confirmFrame("Accept this trade?");
          if (!confirmed) {
            return state;
          }
          const result = await acceptTrade(tradeId);
          return { message: { tone: result.ok ? "success" : "error", text: result.message } };
        }

        if (action === "reject") {
          const result = await rejectTrade(tradeId);
          return { message: { tone: result.ok ? "success" : "error", text: result.message } };
        }

        const result = await cancelTrade(tradeId);
        return { message: { tone: result.ok ? "success" : "error", text: result.message } };
      },
    });
  } catch (error) {
    console.error(`Error: ${String(error instanceof Error ? error.message : "Failed to load trades")}`);
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

  const selected = await selectFrame(
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

  const selected = await selectFrame(
    message,
    [
      ...candidates.map((candidate) => ({
        name: formatCandidateLine(candidate),
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
  const result = await requestTrade(targetUserQuery, myPokemonUid, targetPokemonUid);
  if (result.ok) console.log(result.message);
  else console.error(`Error: ${result.message}`);
}

export async function tradeAcceptCommand(tradeId: string) {
  const result = await acceptTrade(tradeId);
  if (result.ok) console.log(result.message);
  else console.error(`Error: ${result.message}`);
}

export async function tradeRejectCommand(tradeId: string) {
  const result = await rejectTrade(tradeId);
  if (result.ok) console.log(result.message);
  else console.error(`Error: ${result.message}`);
}

export async function tradeCancelCommand(tradeId: string) {
  const result = await cancelTrade(tradeId);
  if (result.ok) console.log(result.message);
  else console.error(`Error: ${result.message}`);
}
