import { apiGet, apiPost } from "../api-client.js";
import { rawSelect, rawConfirm, separator, inputPrompt } from "../ui/prompts.js";
import {
  formatTradeLine,
  formatTradeItem,
  formatCandidateLine,
  buildTradeMenuItems,
  getTradeActions,
  parseTradeChoice,
  type TradeView,
  type TradePokemonCandidate,
} from "../logic/trade.js";
import { DIM, R, GRN, RED, YEL } from "../ui/colors.js";

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

export async function tradeCommand() {
  while (true) {
    const response = await apiGet("/api/game/trades");
    if (!response.ok) {
      console.error(`Error: ${response.data.error}`);
      return;
    }

    const trades = (response.data.trades ?? []) as TradeView[];

    const items: Array<{ name: string; value: string } | { separator: string }> = [];

    if (trades.length > 0) {
      const pending = trades.filter((t) => t.status === "pending");
      const resolved = trades.filter((t) => t.status !== "pending");

      if (pending.length > 0) {
        items.push(separator(`  ${YEL}── 대기 중 ──${R}`));
        for (const trade of pending) {
          items.push({ name: `  ${formatTradeItem(trade)}`, value: `trade:${trade.id}` });
        }
      }
      if (resolved.length > 0) {
        items.push(separator(`  ${DIM}── 완료 ──${R}`));
        for (const trade of resolved.slice(0, 10)) {
          items.push({ name: `  ${DIM}${formatTradeItem(trade)}${R}`, value: `resolved:${trade.id}` });
        }
      }
    } else {
      items.push(separator(`  ${DIM}교환 내역이 없습니다${R}`));
    }

    items.push(separator(" "));
    items.push({ name: "  새 교환 요청", value: "__new__" });
    items.push({ name: "  ← 돌아가기", value: "__back__" });

    const choice = await rawSelect("교환", items, { pageSize: 16 });
    if (!choice || choice === "__back__") return;

    if (choice === "__new__") {
      const query = await inputPrompt("상대 닉네임 또는 ID:");
      if (!query) continue;
      await tradeRequestCommand(query);
      continue;
    }

    if (choice.startsWith("trade:")) {
      const tradeId = choice.slice(6);
      const trade = trades.find((t) => t.id === tradeId);
      if (!trade) continue;

      const actionItems: Array<{ name: string; value: string }> = [];
      if (trade.direction === "incoming") {
        actionItems.push({ name: `${GRN}수락${R}`, value: "accept" });
        actionItems.push({ name: `${RED}거절${R}`, value: "reject" });
      } else {
        actionItems.push({ name: `${RED}취소${R}`, value: "cancel" });
      }
      actionItems.push({ name: "← 돌아가기", value: "__back__" });

      const action = await rawSelect(
        `${formatTradeItem(trade)}`,
        actionItems,
      );

      if (action === "accept") {
        const confirmed = await rawConfirm("정말 수락하시겠습니까?");
        if (confirmed) await tradeAcceptCommand(tradeId);
      } else if (action === "reject") {
        await tradeRejectCommand(tradeId);
      } else if (action === "cancel") {
        await tradeCancelCommand(tradeId);
      }
    }
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

