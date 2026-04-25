/**
 * Scenario 37 — AI Decision Consistency.
 *
 *  - decideBattleAction: same context → same decision
 *  - chooseAiAction (PvP AI): given a deterministic RNG, same input
 *    yields same output
 *  - AI prefers super-effective moves (type-chart aware)
 *  - decideBattleAction picks heal item when HP critical and item
 *    available (already covered in scenario 9; here we verify
 *    determinism specifically)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./setup.js";
import { startTestServer, stopTestServer, type TestContext } from "./test-context.js";
import { decideBattleAction, type BattleAiContext } from "./ai-player.js";
import { chooseAiAction } from "../../src/pvp/pvp-ai.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import type { PvpPlayerState, PvpPokemon } from "../../../../shared/pvp-types.js";

function makePvpMon(species: string, moves: string[], overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: `${species}-${Math.random().toString(36).slice(2, 8)}`,
    species, level: 50,
    hp: 200, maxHp: 200,
    stats: { attack: 100, defense: 80, spAttack: 100, spDefense: 80, speed: 80 },
    moves: moves.map((id) => ({ id, pp: 24, maxPp: 24 })),
    statusCondition: null,
    abilityId: null,
    heldItem: null,
    teraType: null,
    originalTypes: ["normal"],
    stellarTypesUsed: [],
    rageFistHits: 0,
    ...overrides,
  };
}

function makePlayer(party: PvpPokemon[]): PvpPlayerState {
  return {
    userId: `u-${Math.random().toString(36).slice(2, 6)}`,
    nickname: "Test",
    party,
    activeIndex: 0,
    statStages: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 },
    volatiles: [],
    ready: true,
    actionSubmitted: false,
    hasKeyStone: false,
    hasDynamaxBand: false,
    transformationUsed: false,
  };
}

describe("Scenario 37 — AI Decision Consistency", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await stopTestServer(ctx);
  });

  it("decideBattleAction is deterministic for the same context", () => {
    const charizard = createPokemon("charizard", 50);
    const ctxBattle: BattleAiContext = {
      myActivePoke: charizard,
      myParty: [charizard],
      oppActivePoke: { species: "rattata", hp: 50, maxHp: 100, types: ["normal"] },
      myItems: { potion: 1 },
      turn: 1,
    };
    const a = decideBattleAction(ctxBattle);
    const b = decideBattleAction(ctxBattle);
    expect(a).toEqual(b);
  });

  it("decideBattleAction reliably picks heal when HP < 30% and item present", () => {
    const blast = createPokemon("blastoise", 50);
    blast.hp = Math.floor(blast.maxHp * 0.2);
    const decision = decideBattleAction({
      myActivePoke: blast,
      myParty: [blast],
      oppActivePoke: { species: "rattata", hp: 50, maxHp: 100, types: ["normal"] },
      myItems: { potion: 1 },
      turn: 5,
    });
    expect(decision.type).toBe("item");
    expect(decision.itemId).toBe("potion");
  });

  it("chooseAiAction prefers super-effective moves (water vs fire)", () => {
    // AI's pokemon (water type, knows water and normal moves) vs fire opponent.
    const ai = makePlayer([
      makePvpMon("blastoise", ["surf", "tackle"], {
        originalTypes: ["water"],
      }),
    ]);
    const opp = makePlayer([
      makePvpMon("charizard", ["flamethrower"], {
        originalTypes: ["fire", "flying"],
      }),
    ]);

    // Determinism: same setup, same call → same output (RNG is only
    // consulted for the 20% switch path which we avoid by keeping HP full).
    const a = chooseAiAction(ai, opp);
    const b = chooseAiAction(ai, opp);
    expect(a).toEqual(b);
    expect(a.type).toBe("fight");
    if (a.type === "fight") {
      expect(a.moveId).toBe("surf"); // 4x effective vs fire/flying (water 2x, normal 1x)
    }
  });

  it("chooseAiAction with deterministic Math.random produces stable switch decisions", () => {
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.1); // < 0.2 → switch
    try {
      // HP low to enable switch path; party has alternate alive pokemon.
      const partyMon = makePvpMon("blastoise", ["surf"], {
        hp: 30, maxHp: 200, originalTypes: ["water"],
      });
      const benchMon = makePvpMon("venusaur", ["solar-beam"], {
        originalTypes: ["grass"],
      });
      const ai = makePlayer([partyMon, benchMon]);
      const opp = makePlayer([makePvpMon("charizard", ["flamethrower"])]);

      const a = chooseAiAction(ai, opp);
      const b = chooseAiAction(ai, opp);
      expect(a).toEqual(b);
      expect(a.type).toBe("switch");
    } finally {
      mock.mockRestore();
    }
  });

  it("generateTowerParty(stage) called twice gives different rosters (uses RNG)", async () => {
    const { generateTowerParty } = await import("../../src/game/tower-ai.js");
    // The generator shuffles the pool — across many calls we should
    // see at least two distinct species sets emerge.
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const party = generateTowerParty(1);
      seen.add(party.map((p) => p.species).sort().join(","));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("generateTowerParty under fixed RNG is deterministic", async () => {
    const { generateTowerParty } = await import("../../src/game/tower-ai.js");
    const mock = vi.spyOn(Math, "random").mockReturnValue(0.42);
    try {
      const a = generateTowerParty(1).map((p) => p.species);
      const b = generateTowerParty(1).map((p) => p.species);
      expect(a).toEqual(b);
    } finally {
      mock.mockRestore();
    }
  });
});
