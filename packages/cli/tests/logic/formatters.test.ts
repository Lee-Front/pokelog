import { describe, it, expect } from "vitest";
import {
  hpColor,
  ppColor,
  clampScroll,
  clampCursor,
  formatTimeRemaining,
  isExpired,
  pokemonDisplayName,
  partitionTrades,
  formatSlug,
  syncPartyHp,
} from "../../src/logic/formatters.js";

describe("hpColor", () => {
  it("returns red at 25% or below", () => {
    expect(hpColor(25, 100)).toContain("31"); // red
    expect(hpColor(1, 100)).toContain("31");
  });

  it("returns yellow between 25% and 50%", () => {
    expect(hpColor(50, 100)).toContain("33"); // yellow
    expect(hpColor(26, 100)).toContain("33");
  });

  it("returns green above 50%", () => {
    expect(hpColor(51, 100)).toContain("32"); // green
    expect(hpColor(100, 100)).toContain("32");
  });

  it("returns dim for zero max", () => {
    expect(hpColor(0, 0)).toContain("90"); // dim
  });
});

describe("ppColor", () => {
  it("follows same ratio thresholds as hpColor", () => {
    expect(ppColor(1, 10)).toContain("31"); // red <=25%
    expect(ppColor(3, 10)).toContain("33"); // yellow <=50%
    expect(ppColor(8, 10)).toContain("32"); // green >50%
  });
});

describe("clampScroll", () => {
  it("clamps to 0 when items fit in view", () => {
    expect(clampScroll(5, 3, 10)).toBe(0);
  });

  it("clamps to max when scroll exceeds range", () => {
    expect(clampScroll(100, 20, 10)).toBe(10);
  });

  it("preserves valid scroll position", () => {
    expect(clampScroll(5, 20, 10)).toBe(5);
  });
});

describe("clampCursor", () => {
  it("clamps to 0 for empty list", () => {
    expect(clampCursor(5, 0)).toBe(0);
  });

  it("clamps to last index", () => {
    expect(clampCursor(10, 5)).toBe(4);
  });

  it("preserves valid cursor", () => {
    expect(clampCursor(2, 5)).toBe(2);
  });
});

describe("formatTimeRemaining", () => {
  it("shows expired for past dates", () => {
    const past = new Date(Date.now() - 10000).toISOString();
    expect(formatTimeRemaining(past)).toContain("만료");
  });

  it("shows hours and minutes for future dates", () => {
    const future = new Date(Date.now() + 2 * 3600000 + 30 * 60000).toISOString();
    const result = formatTimeRemaining(future);
    expect(result).toContain("2h");
    expect(result).toContain("30m");
  });

  it("shows only minutes when less than 1 hour", () => {
    const future = new Date(Date.now() + 45 * 60000).toISOString();
    const result = formatTimeRemaining(future);
    expect(result).toContain("45m");
    expect(result).not.toContain("h");
  });
});

describe("isExpired", () => {
  it("returns true for past dates", () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
  });

  it("returns false for future dates", () => {
    expect(isExpired(new Date(Date.now() + 60000).toISOString())).toBe(false);
  });
});

describe("pokemonDisplayName", () => {
  it("shows species name when no nickname", () => {
    expect(pokemonDisplayName("pikachu", "피카츄", null)).toBe("피카츄");
  });

  it("shows nickname with species in parentheses", () => {
    expect(pokemonDisplayName("pikachu", "피카츄", "전기쥐")).toBe("전기쥐 (피카츄)");
  });

  it("falls back to slug when speciesName is null", () => {
    expect(pokemonDisplayName("pikachu", null, null)).toBe("pikachu");
  });
});

describe("partitionTrades", () => {
  it("splits pending and resolved trades", () => {
    const trades = [
      { status: "pending", id: "1" },
      { status: "accepted", id: "2" },
      { status: "pending", id: "3" },
      { status: "rejected", id: "4" },
    ];
    const result = partitionTrades(trades);
    expect(result.pending).toHaveLength(2);
    expect(result.resolved).toHaveLength(2);
    expect(result.pending.map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("handles empty array", () => {
    const result = partitionTrades([]);
    expect(result.pending).toHaveLength(0);
    expect(result.resolved).toHaveLength(0);
  });
});

describe("formatSlug", () => {
  it("converts kebab-case to title case", () => {
    expect(formatSlug("thunder-stone")).toBe("Thunder Stone");
  });

  it("handles single word", () => {
    expect(formatSlug("potion")).toBe("Potion");
  });
});

describe("syncPartyHp", () => {
  it("updates HP from new party data", () => {
    const party = [
      { uid: "a", hp: 50, maxHp: 100, species: "pikachu" },
      { uid: "b", hp: 30, maxHp: 80, species: "charmander" },
    ];
    const newParty = [
      { uid: "a", hp: 75, maxHp: 100 },
      { uid: "b", hp: 0, maxHp: 80 },
    ];
    const result = syncPartyHp(party, newParty);
    expect(result[0].hp).toBe(75);
    expect(result[1].hp).toBe(0);
    expect(result[0].species).toBe("pikachu"); // other fields preserved
  });

  it("preserves pokemon not found in new data", () => {
    const party = [{ uid: "x", hp: 50, maxHp: 100 }];
    const result = syncPartyHp(party, []);
    expect(result[0].hp).toBe(50);
  });

  it("does not mutate original array", () => {
    const party = [{ uid: "a", hp: 50, maxHp: 100 }];
    const newParty = [{ uid: "a", hp: 99, maxHp: 100 }];
    const result = syncPartyHp(party, newParty);
    expect(party[0].hp).toBe(50); // original unchanged
    expect(result[0].hp).toBe(99);
  });
});
