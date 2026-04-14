import { describe, expect, it } from "vitest";
import {
  applyLearnedMoves,
  calculateStatsForLevel,
  buildLevelEvolutionContext,
  checkEvolution,
  checkLevelUp,
  getEvolutionBranchDiagnostics,
  getMatchingEvolutionBranches,
  getEvolutionBranches,
  getEvolutionItemUseTarget,
  getExpForLevel,
} from "../../src/game/growth.js";
import type { OwnedPokemon } from "../../../../shared/types.js";

function createOwnedPokemon(overrides: Partial<OwnedPokemon> = {}): OwnedPokemon {
  return {
    uid: "test-uid",
    species: "charmander",
    nickname: null,
    level: 5,
    exp: 0,
    hp: 30,
    maxHp: 30,
    stats: { attack: 20, defense: 18, speed: 22, spAttack: 21, spDefense: 19 },
    moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
    caughtAt: "2024-01-01T00:00:00Z",
    gender: null,
    friendship: 70,
    heldItem: null,
    abilityId: null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    ...overrides,
  };
}

describe("getExpForLevel", () => {
  it("returns cubic exp values", () => {
    expect(getExpForLevel(1)).toBe(1);
    expect(getExpForLevel(10)).toBe(1000);
    expect(getExpForLevel(100)).toBe(1000000);
  });
});

describe("checkLevelUp", () => {
  it("detects level up when exp is sufficient", () => {
    const result = checkLevelUp(createOwnedPokemon({ exp: 216 }));
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(6);
  });

  it("does not level up when exp is insufficient", () => {
    const result = checkLevelUp(createOwnedPokemon({ exp: 100 }));
    expect(result.leveled).toBe(false);
    expect(result.newLevel).toBe(5);
  });

  it("can level up multiple times at once", () => {
    const result = checkLevelUp(createOwnedPokemon({ exp: 1000 }));
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(10);
  });

  it("reports moves learned at gained levels", () => {
    const result = checkLevelUp(createOwnedPokemon({
      level: 3,
      exp: 64,
      moves: [{ id: "scratch", pp: 35, maxPp: 35 }],
    }));

    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(4);
    expect(result.newMoves).toContain("ember");
  });
});

describe("calculateStatsForLevel", () => {
  it("calculates HP correctly", () => {
    const result = calculateStatsForLevel("charmander", 10);
    expect(result.hp).toBe(27);
    expect(result.maxHp).toBe(27);
  });

  it("calculates attack stat correctly", () => {
    const result = calculateStatsForLevel("charmander", 10);
    expect(result.stats.attack).toBe(15);
  });

  it("calculates speed stat correctly", () => {
    const result = calculateStatsForLevel("charmander", 10);
    expect(result.stats.speed).toBe(18);
  });

  it("applies nature stat increase (adamant: +attack, -spAttack)", () => {
    const base = calculateStatsForLevel("charmander", 50);
    const adamant = calculateStatsForLevel("charmander", 50, "adamant");
    expect(adamant.stats.attack).toBeGreaterThan(base.stats.attack);
    expect(adamant.stats.spAttack).toBeLessThan(base.stats.spAttack);
    // HP is unaffected by nature
    expect(adamant.hp).toBe(base.hp);
    // Other stats unchanged
    expect(adamant.stats.defense).toBe(base.stats.defense);
    expect(adamant.stats.speed).toBe(base.stats.speed);
  });

  it("neutral nature (hardy) does not change stats", () => {
    const base = calculateStatsForLevel("charmander", 50);
    const hardy = calculateStatsForLevel("charmander", 50, "hardy");
    expect(hardy.stats).toEqual(base.stats);
    expect(hardy.hp).toBe(base.hp);
  });

  it("returns same stats when nature is undefined", () => {
    const noNature = calculateStatsForLevel("charmander", 50);
    const undefinedNature = calculateStatsForLevel("charmander", 50, undefined);
    expect(noNature.stats).toEqual(undefinedNature.stats);
  });
});

describe("checkEvolution", () => {
  it("returns evolution target when level condition is met", () => {
    expect(checkEvolution("charmander", 16)).toBe("charmeleon");
  });

  it("returns null when level condition is not met", () => {
    expect(checkEvolution("charmander", 15)).toBeNull();
  });

  it("returns null for species with no evolution", () => {
    expect(checkEvolution("venusaur", 50)).toBeNull();
  });

  it("returns null for unknown species", () => {
    expect(checkEvolution("unknown_pokemon", 50)).toBeNull();
  });

  it("does not treat trade evolutions as level-up evolutions", () => {
    expect(checkEvolution("kadabra", 30)).toBeNull();
  });

  it("does not treat item evolution as level evolution", () => {
    expect(checkEvolution("pikachu", 99)).toBeNull();
  });

  it("supports item-use evolution lookup", () => {
    expect(getEvolutionItemUseTarget("pikachu", "thunder-stone")).toBe("raichu");
    expect(getEvolutionItemUseTarget("pikachu", "moon-stone")).toBeNull();
  });

  it("supports friendship and time-based evolution conditions", () => {
    expect(checkEvolution("riolu", 30, {
      friendship: 170,
      timeOfDay: "day",
    })).toBe("lucario");

    expect(checkEvolution("riolu", 30, {
      friendship: 170,
      timeOfDay: "night",
    })).toBeNull();
  });

  it("supports gender evolution conditions", () => {
    expect(checkEvolution("burmy", 20, {
      gender: "female",
    })).toBe("wormadam");

    expect(checkEvolution("burmy", 20, {
      gender: "male",
    })).toBe("mothim");
  });

  it("supports known-move evolution conditions", () => {
    expect(checkEvolution("aipom", 32, {
      knownMoveIds: ["double-hit"],
    })).toBe("ambipom");
  });

  it("supports stat comparison evolution conditions", () => {
    expect(checkEvolution("tyrogue", 20, {
      attack: 30,
      defense: 20,
    })).toBe("hitmonlee");
    expect(checkEvolution("tyrogue", 20, {
      attack: 20,
      defense: 30,
    })).toBe("hitmonchan");
    expect(checkEvolution("tyrogue", 20, {
      attack: 25,
      defense: 25,
    })).toBe("hitmontop");
  });

  it("supports party-member evolution conditions", () => {
    expect(checkEvolution("pancham", 32, {
      partyTypes: ["dark"],
    })).toBe("pangoro");
  });

  it("supports location conditions through region aliases", () => {
    expect(checkEvolution("magneton", 40, {
      region: "sinnoh",
    })).toBe("magnezone");

    expect(checkEvolution("magneton", 40, {
      region: "kanto",
    })).toBeNull();
  });

  it("supports min_affection extra conditions through friendship approximation", () => {
    expect(checkEvolution("eevee", 30, {
      friendship: 120,
      knownMoveTypes: ["fairy"],
    })).toBe("sylveon");

    expect(checkEvolution("eevee", 30, {
      friendship: 100,
      knownMoveTypes: ["fairy"],
    })).toBeNull();
  });

  it("exposes branch metadata", () => {
    const branches = getEvolutionBranches("pikachu");
    expect(branches).toHaveLength(1);
    expect(branches[0]?.trigger).toBe("use-item");
  });

  it("reports blocked item-use evolutions in diagnostics", () => {
    const diagnostics = getEvolutionBranchDiagnostics("pikachu", {
      level: 30,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.status).toBe("blocked");
    expect(diagnostics[0]?.blockers).toContain("Use thunder-stone");
  });

  it("reports unsupported trade evolutions in diagnostics", () => {
    const diagnostics = getEvolutionBranchDiagnostics("kadabra", {
      level: 30,
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.status).toBe("unsupported");
    expect(diagnostics[0]?.blockers).toContain("Requires trade with another user");
  });

  it("reports blockers for project-specific extra evolution substitutes", () => {
    const inkayDiagnostics = getEvolutionBranchDiagnostics("inkay", {
      level: 29,
      knownMoveIds: [],
    });

    expect(inkayDiagnostics).toHaveLength(1);
    expect(inkayDiagnostics[0]?.status).toBe("blocked");
    expect(inkayDiagnostics[0]?.blockers).toContain("Level 30+ (current 29)");
    expect(inkayDiagnostics[0]?.blockers).toContain("Know move: topsy-turvy");

    const yamaskDiagnostics = getEvolutionBranchDiagnostics("yamask", {
      level: 35,
      damageTakenTotal: 12,
    });

    expect(yamaskDiagnostics).toHaveLength(2);
    const runerigusBranch = yamaskDiagnostics.find((entry) => entry.targetSpecies === "runerigus");
    expect(runerigusBranch?.status).toBe("blocked");
    expect(runerigusBranch?.blockers).toContain("Take 49+ total damage (12/49)");
  });

  it("supports move-usage evolution conditions when usage counters are present", () => {
    expect(checkEvolution("primeape", 35, {
      moveUsageCounts: { "rage-fist": 20 },
    })).toBe("annihilape");

    expect(checkEvolution("stantler", 35, {
      moveUsageCounts: { "psyshield-bash": 20 },
    })).toBe("wyrdeer");
  });

  it("supports remaining project-specific extra evolution substitutes", () => {
    expect(checkEvolution("feebas", 30, {
      friendship: 170,
    })).toBe("milotic");

    expect(checkEvolution("sliggoo", 50, {
      region: "kalos",
    })).toBe("goodra");

    expect(checkEvolution("inkay", 30, {
      knownMoveIds: ["topsy-turvy"],
    })).toBe("malamar");

    expect(checkEvolution("basculin", 35, {
      damageTakenTotal: 294,
    })).toBe("basculegion");

    const yamaskBranches = getMatchingEvolutionBranches("yamask", {
      level: 35,
      damageTakenTotal: 49,
    });
    expect(yamaskBranches.map((branch) => branch.targetSpecies)).toContain("runerigus");
  });
});

describe("applyLearnedMoves", () => {
  it("adds newly learned moves and keeps the last four", () => {
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "growl", pp: 40, maxPp: 40 },
        { id: "ember", pp: 25, maxPp: 25 },
      ],
    });

    const learned = applyLearnedMoves(pokemon, ["smokescreen", "dragon-breath"]);

    expect(learned).toEqual(["smokescreen", "dragon-breath"]);
    expect(pokemon.moves.map((move) => move.id)).toEqual([
      "growl",
      "ember",
      "smokescreen",
      "dragon-breath",
    ]);
  });
});

describe("buildLevelEvolutionContext", () => {
  it("derives known moves, party information, and time of day", () => {
    const pokemon = createOwnedPokemon({
      species: "pancham",
      gender: "female",
      friendship: 180,
      heldItem: "razor-claw",
      moves: [
        { id: "low-kick", pp: 20, maxPp: 20 },
        { id: "bite", pp: 25, maxPp: 25 },
      ],
      stats: { attack: 30, defense: 20, speed: 25, spAttack: 20, spDefense: 20 },
    });
    const party = [
      pokemon,
      createOwnedPokemon({ species: "murkrow" }),
    ];

    const context = buildLevelEvolutionContext(pokemon, party, {
      now: new Date("2026-04-12T13:00:00"),
      region: "default",
    });

    expect(context.friendship).toBe(180);
    expect(context.heldItem).toBe("razor-claw");
    expect(context.gender).toBe("female");
    expect(context.timeOfDay).toBe("day");
    expect(context.knownMoveIds).toEqual(["low-kick", "bite"]);
    expect(context.knownMoveTypes).toContain("dark");
    expect(context.partySpecies).toContain("murkrow");
    expect(context.partyTypes).toContain("dark");
    expect(context.attack).toBe(30);
    expect(context.defense).toBe(20);
  });
});
