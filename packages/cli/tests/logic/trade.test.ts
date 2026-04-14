import { describe, it, expect } from "vitest";
import {
  formatTradeLine,
  formatTradeItem,
  formatCandidateLine,
  buildTradeMenuItems,
  getTradeActions,
  findTradeById,
  parseTradeChoice,
  type TradeView,
  type TradePokemonCandidate,
} from "../../src/logic/trade.js";

function makeTrade(overrides: Partial<TradeView> = {}): TradeView {
  return {
    id: "trade-1",
    status: "pending",
    direction: "incoming",
    requester: {
      userId: "user1",
      nickname: "Alice",
      pokemonUid: "poke-1",
      species: "pikachu",
      speciesName: "피카츄",
    },
    responder: {
      userId: "user2",
      nickname: "Bob",
      pokemonUid: "poke-2",
      species: "charmander",
      speciesName: "파이리",
    },
    ...overrides,
  };
}

describe("formatTradeLine", () => {
  it("includes trade id, status, species names, and user info", () => {
    const line = formatTradeLine(makeTrade());
    expect(line).toContain("trade-1");
    expect(line).toContain("pending");
    expect(line).toContain("피카츄");
    expect(line).toContain("파이리");
    expect(line).toContain("Alice");
    expect(line).toContain("Bob");
  });

  it("falls back to species slug when speciesName is null", () => {
    const trade = makeTrade({
      requester: { userId: "u1", nickname: "A", pokemonUid: "p1", species: "eevee", speciesName: null },
      responder: { userId: "u2", nickname: "B", pokemonUid: "p2", species: null, speciesName: null },
    });
    const line = formatTradeLine(trade);
    expect(line).toContain("eevee");
    expect(line).toContain("p2"); // falls back to pokemonUid
  });
});

describe("formatTradeItem", () => {
  it("shows incoming arrow for received requests", () => {
    const item = formatTradeItem(makeTrade({ direction: "incoming" }));
    expect(item).toContain("받은 요청");
    expect(item).toContain("Alice"); // shows requester as partner
  });

  it("shows outgoing arrow for sent requests", () => {
    const item = formatTradeItem(makeTrade({ direction: "outgoing" }));
    expect(item).toContain("보낸 요청");
    expect(item).toContain("Bob"); // shows responder as partner
  });
});

describe("formatCandidateLine", () => {
  it("formats candidate with nickname", () => {
    const candidate: TradePokemonCandidate = {
      uid: "uid-1",
      species: "pikachu",
      speciesName: "피카츄",
      nickname: "전기쥐",
      level: 25,
      location: "party",
    };
    const line = formatCandidateLine(candidate);
    expect(line).toContain("전기쥐 (피카츄)");
    expect(line).toContain("Lv.25");
    expect(line).toContain("Party");
  });

  it("formats candidate without nickname", () => {
    const candidate: TradePokemonCandidate = {
      uid: "uid-2",
      species: "charmander",
      speciesName: "파이리",
      nickname: null,
      level: 10,
      location: "storage",
    };
    const line = formatCandidateLine(candidate);
    expect(line).toContain("파이리");
    expect(line).not.toContain("(");
    expect(line).toContain("Storage");
  });
});

describe("buildTradeMenuItems", () => {
  it("groups pending and resolved trades", () => {
    const trades = [
      makeTrade({ id: "t1", status: "pending" }),
      makeTrade({ id: "t2", status: "accepted" }),
      makeTrade({ id: "t3", status: "pending" }),
    ];
    const items = buildTradeMenuItems(trades);

    const separators = items.filter((i) => i.type === "separator");
    const choices = items.filter((i) => i.type === "choice");

    expect(separators.length).toBe(2); // pending header + resolved header
    expect(choices.length).toBe(3);
    expect(choices[0].value).toBe("trade:t1");
    expect(choices[1].value).toBe("trade:t3");
    expect(choices[2].value).toBe("resolved:t2");
  });

  it("shows empty message when no trades", () => {
    const items = buildTradeMenuItems([]);
    expect(items.some((i) => i.text.includes("교환 내역이 없습니다"))).toBe(true);
  });

  it("limits resolved trades to 10", () => {
    const trades = Array.from({ length: 15 }, (_, i) =>
      makeTrade({ id: `t${i}`, status: "accepted" }),
    );
    const items = buildTradeMenuItems(trades);
    const resolved = items.filter((i) => i.type === "choice");
    expect(resolved.length).toBe(10);
  });
});

describe("getTradeActions", () => {
  it("returns accept/reject for incoming trades", () => {
    const actions = getTradeActions(makeTrade({ direction: "incoming" }));
    expect(actions.map((a) => a.action)).toEqual(["accept", "reject"]);
  });

  it("returns cancel for outgoing trades", () => {
    const actions = getTradeActions(makeTrade({ direction: "outgoing" }));
    expect(actions.map((a) => a.action)).toEqual(["cancel"]);
  });
});

describe("findTradeById", () => {
  it("finds existing trade", () => {
    const trades = [makeTrade({ id: "a" }), makeTrade({ id: "b" })];
    expect(findTradeById(trades, "b")?.id).toBe("b");
  });

  it("returns undefined for missing id", () => {
    expect(findTradeById([makeTrade()], "nonexistent")).toBeUndefined();
  });
});

describe("parseTradeChoice", () => {
  it("parses trade selection", () => {
    expect(parseTradeChoice("trade:abc")).toEqual({ type: "trade", id: "abc" });
  });

  it("parses resolved selection", () => {
    expect(parseTradeChoice("resolved:xyz")).toEqual({ type: "resolved", id: "xyz" });
  });

  it("parses new trade", () => {
    expect(parseTradeChoice("__new__")).toEqual({ type: "new" });
  });

  it("parses back", () => {
    expect(parseTradeChoice("__back__")).toEqual({ type: "back" });
  });

  it("treats empty string as back", () => {
    expect(parseTradeChoice("")).toEqual({ type: "back" });
  });
});
