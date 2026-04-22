import { describe, it, expect } from "vitest";
import {
  formatStatStages, formatVolatiles, formatStatus,
  formatMoveInfo, colorizeType, TYPE_ABBR,
  formatPokemonPanel, formatFieldEffects, formatPartyStatus, formatOppPartyStatus,
} from "../../src/ui/battle-display.js";
import { stripAnsi } from "../../src/ui/text.js";
import type { PvpClientRoomView, PvpPokemon } from "../../../../shared/pvp-types.js";
import type { StatStages } from "../../../../shared/types.js";

const zeroStages: StatStages = {
  attack: 0, defense: 0, spAttack: 0, spDefense: 0,
  speed: 0, accuracy: 0, evasion: 0,
};

function pokemon(overrides: Partial<PvpPokemon> = {}): PvpPokemon {
  return {
    uid: "p-1",
    species: "pikachu",
    level: 50,
    hp: 80, maxHp: 100,
    stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    moves: [{ id: "tackle", pp: 35, maxPp: 35 }],
    statusCondition: null,
    ...overrides,
  };
}

describe("formatStatStages", () => {
  it("returns empty for undefined or all-zero", () => {
    expect(formatStatStages(undefined)).toBe("");
    expect(formatStatStages(zeroStages)).toBe("");
  });

  it("formats positive and negative stages", () => {
    const s: StatStages = { ...zeroStages, attack: 2, speed: -1 };
    const result = stripAnsi(formatStatStages(s));
    expect(result).toContain("+2 Atk");
    expect(result).toContain("-1 Spd");
  });
});

describe("formatVolatiles", () => {
  it("empty when no volatiles", () => {
    expect(formatVolatiles(undefined)).toBe("");
    expect(formatVolatiles([])).toBe("");
  });

  it("shows label with turns", () => {
    const result = stripAnsi(formatVolatiles([
      { id: "confusion", turnsRemaining: 3 },
      { id: "leech-seed", turnsRemaining: 0 },
    ]));
    expect(result).toContain("Confusion(3T)");
    expect(result).toContain("LeechSeed");
  });
});

describe("formatStatus", () => {
  it("empty for no status", () => {
    expect(formatStatus(null)).toBe("");
    expect(formatStatus(undefined)).toBe("");
  });

  it("labels BRN/PSN/PAR/SLP/FRZ", () => {
    expect(stripAnsi(formatStatus("burn"))).toBe("BRN");
    expect(stripAnsi(formatStatus("paralysis"))).toBe("PAR");
    expect(stripAnsi(formatStatus("freeze"))).toBe("FRZ");
  });

  it("adds toxic counter", () => {
    expect(stripAnsi(formatStatus("poison", 3))).toBe("PSN(Toxic x3)");
  });

  it("adds sleep turns", () => {
    expect(stripAnsi(formatStatus("sleep", 0, 2))).toBe("SLP(2T)");
  });
});

describe("formatMoveInfo", () => {
  it("handles undefined info", () => {
    expect(stripAnsi(formatMoveInfo(undefined))).toBe("---");
  });

  it("formats phys move", () => {
    const s = stripAnsi(formatMoveInfo({
      id: "tackle", name: "tackle", type: "normal", category: "physical",
      power: 40, accuracy: 100, pp: 35,
    }));
    expect(s).toContain("Normal");
    expect(s).toContain("Phys");
    expect(s).toContain("40");
  });

  it("formats status move with dash power", () => {
    const s = stripAnsi(formatMoveInfo({
      id: "thunder-wave", name: "tw", type: "electric", category: "status",
      power: 0, accuracy: 90, pp: 20,
    }));
    expect(s).toContain("Elec");
    expect(s).toContain("Stat");
    expect(s).toContain("-");
  });
});

describe("colorizeType", () => {
  it("uses abbreviation", () => {
    expect(stripAnsi(colorizeType("fighting"))).toBe("Fight");
    expect(stripAnsi(colorizeType("psychic"))).toBe("Psyc");
  });

  it("falls back for unknown", () => {
    expect(stripAnsi(colorizeType("unknowntype"))).toBe("unknowntype");
  });
});

describe("formatPokemonPanel", () => {
  it("shows transformation + gender + hp", () => {
    const p = pokemon({ species: "charizard", gender: "female", hp: 50, maxHp: 100 });
    const lines = formatPokemonPanel({
      poke: p,
      transformationType: "mega",
      isOpponent: true,
    });
    const body = lines.map(stripAnsi).join("\n");
    expect(body).toContain("charizard");
    expect(body).toContain("[MEGA]");
    expect(body).toContain("Lv.50");
    expect(body).toContain("F");
    expect(body).toContain("50/100");
  });

  it("shows status + volatiles + substitute + stages", () => {
    const p = pokemon({ statusCondition: "burn", toxicCounter: 0 });
    const lines = formatPokemonPanel({
      poke: p,
      volatiles: [{ id: "confusion", turnsRemaining: 2 }],
      substitute: 30,
      statStages: { ...zeroStages, attack: 2 },
      isOpponent: false,
    });
    const body = lines.map(stripAnsi).join("\n");
    expect(body).toContain("BRN");
    expect(body).toContain("Confusion(2T)");
    expect(body).toContain("Sub:30");
    expect(body).toContain("+2 Atk");
  });

  it("shows tera label when teraActive", () => {
    const p = pokemon({ teraType: "fire" });
    const lines = formatPokemonPanel({
      poke: p,
      transformationType: "tera",
      teraActive: true,
      isOpponent: false,
    });
    const body = lines.map(stripAnsi).join("\n");
    expect(body).toContain("TERA");
    expect(body).toContain(TYPE_ABBR.fire);
  });
});

describe("formatFieldEffects", () => {
  it("shows weather + terrain + trick room + side effects", () => {
    const state = {
      roomId: "r1", turn: 3, phase: "action",
      me: {
        userId: "u1", nickname: "me", party: [pokemon()], activeIndex: 0,
        statStages: zeroStages, volatiles: [], ready: true, actionSubmitted: false,
        screens: { reflect: 3 },
        hazards: { stealthRock: true, spikes: 2 },
        tailwind: 2,
      },
      opponent: {
        nickname: "opp", activePokemon: pokemon(), partyHpRatios: [1],
        ready: true, actionSubmitted: false,
        hazards: { stickyWeb: true },
        screens: { lightScreen: 2 },
      },
      weather: "rain", weatherTurns: 3,
      terrain: "electric", terrainTurns: 4,
      trickRoom: 2,
      turnDeadline: null, log: [], isAiBattle: false,
    } as unknown as PvpClientRoomView;

    const lines = formatFieldEffects(state).map(stripAnsi).join("\n");
    expect(lines).toContain("[Rain 3T]");
    expect(lines).toContain("[Electric 4T]");
    expect(lines).toContain("[TrickRoom 2T]");
    expect(lines).toContain("[SR]");
    expect(lines).toContain("[Spikes x2]");
    expect(lines).toContain("[Reflect 3T]");
    expect(lines).toContain("[Tailwind 2T]");
    expect(lines).toContain("[Web]");
    expect(lines).toContain("[LightScreen 2T]");
  });

  it("returns empty lines if no effects", () => {
    const state = {
      roomId: "r1", turn: 1, phase: "action",
      me: {
        userId: "u1", nickname: "me", party: [pokemon()], activeIndex: 0,
        statStages: zeroStages, volatiles: [], ready: true, actionSubmitted: false,
      },
      opponent: {
        nickname: "opp", activePokemon: pokemon(), partyHpRatios: [1],
        ready: true, actionSubmitted: false,
      },
      turnDeadline: null, log: [], isAiBattle: false,
    } as unknown as PvpClientRoomView;
    expect(formatFieldEffects(state)).toEqual([]);
  });
});

describe("formatPartyStatus", () => {
  it("renders my party with active marker + hp% + fnt", () => {
    const state = {
      me: {
        userId: "u1", nickname: "me",
        party: [
          pokemon({ species: "pikachu", hp: 50, maxHp: 100 }),
          pokemon({ species: "charizard", hp: 0, maxHp: 100 }),
        ],
        activeIndex: 0,
        statStages: zeroStages, volatiles: [], ready: true, actionSubmitted: false,
      },
      opponent: {
        nickname: "opp",
        activePokemon: pokemon({ hp: 80, maxHp: 100 }),
        partyHpRatios: [0.8, 0],
        ready: true, actionSubmitted: false,
      },
    } as unknown as PvpClientRoomView;

    const my = stripAnsi(formatPartyStatus(state));
    expect(my).toContain("pikachu");
    expect(my).toContain("HP:50");
    expect(my).toContain("FNT");

    const opp = stripAnsi(formatOppPartyStatus(state));
    expect(opp).toContain("HP:80%");
    expect(opp).toContain("FNT");
  });
});
