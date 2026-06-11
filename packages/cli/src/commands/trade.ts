import { apiGet, apiPost } from "../api-client.js";
import { separator, inputPrompt } from "../ui/prompts.js";
import {
  formatTradeLine,
  formatTradeItem,
  formatCandidateLine,
  describeTradeEvolutions,
  type TradeView,
  type TradeEvolution,
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
  evolutions?: string[];
};

async function requestTrade(
  targetUserQuery: string,
  myPokemonUid?: string,
  targetPokemonUid?: string,
): Promise<TradeActionResult> {
  const target = await resolveTargetUserId(targetUserQuery);
  if (!target.ok) {
    return { ok: false, message: target.error };
  }
  const targetUserId = target.userId;

  const candidatesResponse = await apiGet(`/api/game/trades/candidates/${encodeURIComponent(targetUserId)}`);
  if (!candidatesResponse.ok) {
    return { ok: false, message: String(candidatesResponse.data.error) };
  }

  const candidates = candidatesResponse.data as TradeCandidatesResponse;
  const mine = await chooseTradePokemon(
    "Your Pokemon",
    `Choose your Pokemon for ${candidates.responder.nickname}`,
    candidates.requester.pokemon,
    myPokemonUid,
  );
  if (!mine.ok) {
    return { ok: false, message: mine.error };
  }

  const theirs = await chooseTradePokemon(
    "Target Pokemon",
    `Choose ${candidates.responder.nickname}'s Pokemon to request`,
    candidates.responder.pokemon,
    targetPokemonUid,
  );
  if (!theirs.ok) {
    return { ok: false, message: theirs.error };
  }

  const response = await apiPost("/api/game/trades/request", {
    targetUserId,
    myPokemonUid: mine.uid,
    targetPokemonUid: theirs.uid,
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
  const evolutions = describeTradeEvolutions(
    response.data.responderEvolution as TradeEvolution | undefined,
    response.data.requesterEvolution as TradeEvolution | undefined,
  );
  return { ok: true, message: `Trade accepted: ${formatTradeLine(trade)}`, evolutions };
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
          if (result.ok && result.evolutions && result.evolutions.length > 0) {
            await selectFrame(`${GRN}Trade complete!${R}`, [
              ...result.evolutions.map((line) => separator(`  ${GRN}${line}${R}`)),
              separator(" "),
              { name: "Continue", value: "__ok__" },
            ]);
          }
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
    // runMenuLoop이 예외로 빠져나오면 커서가 숨겨진 상태로 남을 수 있으므로 복원
    process.stdout.write("\x1b[?25h");
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

type ResolveResult<T> = { ok: true } & T | { ok: false; error: string };

async function resolveTargetUserId(query: string): Promise<ResolveResult<{ userId: string }>> {
  const response = await apiGet(`/api/user/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    return { ok: false, error: String(response.data.error) };
  }

  const users = (response.data.users ?? []) as TradeUserSearchResult[];
  if (users.length === 0) {
    return { ok: false, error: "No matching users." };
  }

  if (users.length === 1) {
    return { ok: true, userId: users[0].id };
  }

  const exact = users.find((user) => user.id === query);
  if (exact) {
    return { ok: true, userId: exact.id };
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
    return { ok: false, error: "Trade target not selected." };
  }

  return { ok: true, userId: selected };
}

async function chooseTradePokemon(
  sideLabel: string,
  message: string,
  candidates: TradePokemonCandidate[],
  requestedUid?: string,
): Promise<ResolveResult<{ uid: string }>> {
  if (candidates.length === 0) {
    return { ok: false, error: `${sideLabel}: no tradeable Pokemon available.` };
  }

  if (requestedUid) {
    const exact = candidates.find((candidate) => candidate.uid === requestedUid);
    if (!exact) {
      return { ok: false, error: `${sideLabel} not found or not tradeable: ${requestedUid}` };
    }
    return { ok: true, uid: exact.uid };
  }

  if (candidates.length === 1) {
    return { ok: true, uid: candidates[0].uid };
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
    return { ok: false, error: `${sideLabel} was not selected.` };
  }

  return { ok: true, uid: selected };
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
