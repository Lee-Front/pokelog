import { describe, expect, it } from "vitest";
import {
  applyExpToPokemon,
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
  getExpForLevelInGroup,
  gainFriendshipFromBattle,
  MAX_FRIENDSHIP,
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
    // charmander는 medium-slow 곡선 — 누적 exp 1000이면 레벨 12까지 오른다(세제곱 곡선의 10이 아님).
    const result = checkLevelUp(createOwnedPokemon({ exp: 1000 }));
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(12);
  });

  it("reports moves learned at gained levels", () => {
    // charmander(medium-slow) 레벨 4 도달 임계치까지 채워 레벨업 시 배우는 기술을 검증.
    const result = checkLevelUp(createOwnedPokemon({
      level: 3,
      exp: getExpForLevelInGroup("medium-slow", 4),
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
    // adamant: attack * 1.1, spAttack * 0.9 (정확한 배수 검증)
    expect(adamant.stats.attack).toBe(Math.floor(base.stats.attack * 1.1));
    expect(adamant.stats.spAttack).toBe(Math.floor(base.stats.spAttack * 0.9));
    // HP is unaffected by nature
    expect(adamant.hp).toBe(base.hp);
    // Other stats unchanged
    expect(adamant.stats.defense).toBe(base.stats.defense);
    expect(adamant.stats.speed).toBe(base.stats.speed);
    expect(adamant.stats.spDefense).toBe(base.stats.spDefense);
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
    const result = getEvolutionItemUseTarget("pikachu", "thunder-stone");
    expect(result).not.toBeNull();
    expect(result!.targetSpecies).toBe("raichu");
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

    // 신규 Gen-9 known-move 진화: 대상 종이 species.json에 추가되어 매칭된다.
    expect(checkEvolution("dunsparce", 30, {
      knownMoveIds: ["hyper-drill"],
    })).toBe("dudunsparce");

    expect(checkEvolution("girafarig", 30, {
      knownMoveIds: ["twin-beam"],
    })).toBe("farigiraf");
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
    // primeape-annihilape-1: 이동 사용(min_move_count=20, rage-fist) 조건을 충족하고
    // 대상 종 annihilape가 이제 species.json에 존재하므로 진화가 정상적으로 매칭된다.
    expect(checkEvolution("primeape", 35, {
      moveUsageCounts: { "rage-fist": 20 },
    })).toBe("annihilape");

    // 사용 횟수가 임계값(20) 미만이면 조건을 만족하지 못해 매칭되지 않는다.
    expect(checkEvolution("primeape", 35, {
      moveUsageCounts: { "rage-fist": 19 },
    })).toBeNull();

    // 대상 종(wyrdeer)이 존재하는 이동 사용 진화는 정상적으로 매칭된다.
    expect(checkEvolution("stantler", 35, {
      moveUsageCounts: { "psyshield-bash": 20 },
    })).toBe("wyrdeer");
  });

  it("offers clodsire alongside quagsire as a wooper level-20 evolution option", () => {
    // clodsire가 species.json에 추가되어, 안전 필터가 더 이상 이 분기를 제외하지 않는다.
    const branches = getMatchingEvolutionBranches("wooper", { level: 20 });
    const targets = branches.map((branch) => branch.targetSpecies);
    expect(targets).toContain("quagsire");
    expect(targets).toContain("clodsire");
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
  it("fills empty slots only and queues overflow as pending (no FIFO shift)", () => {
    const pokemon = createOwnedPokemon({
      moves: [
        { id: "scratch", pp: 35, maxPp: 35 },
        { id: "growl", pp: 40, maxPp: 40 },
        { id: "ember", pp: 25, maxPp: 25 },
      ],
    });

    const result = applyLearnedMoves(pokemon, ["smokescreen", "dragon-breath"]);

    // 빈 슬롯(1개)에는 smokescreen만 들어가고, 넘친 dragon-breath는 pending으로.
    expect(result.learned).toEqual(["smokescreen"]);
    expect(result.pending).toEqual(["dragon-breath"]);
    expect(pokemon.moves.map((move) => move.id)).toEqual([
      "scratch",
      "growl",
      "ember",
      "smokescreen",
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

describe("applyExpToPokemon (no auto-evolution / no queuing)", () => {
  it("levels a charmander past its evolution threshold WITHOUT changing species", () => {
    // charmander는 레벨 16에 charmeleon으로 진화하지만, applyExpToPokemon은 더 이상 진화시키지 않는다.
    // charmander는 medium-slow 곡선이므로 씨딩/획득 exp도 해당 곡선 기준으로 계산한다.
    const charmander = createOwnedPokemon({ species: "charmander", level: 15, exp: getExpForLevelInGroup("medium-slow", 15) });
    const gained = getExpForLevelInGroup("medium-slow", 20) - getExpForLevelInGroup("medium-slow", 15);

    const result = applyExpToPokemon(charmander, gained, { party: [charmander] });

    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(20);
    // 종은 그대로 — 자동 진화 없음.
    expect(charmander.species).toBe("charmander");
    // 반환 결과에서도 진화 필드가 제거됐다(evolvedBranch/pendingBranches 없음).
    expect(result).not.toHaveProperty("evolvedBranch");
    expect(result).not.toHaveProperty("pendingBranches");
  });

  it("still recalculates stats and reports learned moves on level-up", () => {
    const charmander = createOwnedPokemon({ species: "charmander", level: 15, exp: getExpForLevelInGroup("medium-slow", 15) });
    const before = charmander.maxHp;

    const result = applyExpToPokemon(charmander, getExpForLevelInGroup("medium-slow", 18) - getExpForLevelInGroup("medium-slow", 15), { party: [charmander] });

    expect(result.leveled).toBe(true);
    expect(charmander.level).toBe(18);
    expect(charmander.maxHp).toBeGreaterThan(before); // 스탯 재계산은 유지된다.
  });
});

describe("친밀도(friendship) 누적 — 친밀도 진화 도달용", () => {
  it("레벨업 시 친밀도가 티어별로 오른다(<100 → 레벨당 +5)", () => {
    // 15→18(3레벨), friendship 70에서 매 레벨 +5 → 85. charmander는 medium-slow 곡선.
    const mon = createOwnedPokemon({ species: "charmander", level: 15, exp: getExpForLevelInGroup("medium-slow", 15), friendship: 70 });
    applyExpToPokemon(mon, getExpForLevelInGroup("medium-slow", 18) - getExpForLevelInGroup("medium-slow", 15), { party: [mon] });
    expect(mon.level).toBe(18);
    expect(mon.friendship).toBe(85);
  });

  it("친밀도 티어 경계를 넘기며 오른다(<100 +5 → 100~199 +3)", () => {
    // 96 → 101(+5) → 104(+3) → 107(+3). charmander는 medium-slow 곡선(15→18, 3레벨).
    const mon = createOwnedPokemon({ species: "charmander", level: 15, exp: getExpForLevelInGroup("medium-slow", 15), friendship: 96 });
    applyExpToPokemon(mon, getExpForLevelInGroup("medium-slow", 18) - getExpForLevelInGroup("medium-slow", 15), { party: [mon] });
    expect(mon.friendship).toBe(107);
  });

  it("레벨업이 없으면 친밀도는 그대로다", () => {
    // 현재 레벨 임계치(medium-slow)에서 exp +1만으론 레벨업하지 않는다 → 친밀도 불변.
    const mon = createOwnedPokemon({ species: "charmander", level: 15, exp: getExpForLevelInGroup("medium-slow", 15), friendship: 70 });
    applyExpToPokemon(mon, 1, { party: [mon] });
    expect(mon.friendship).toBe(70);
  });

  it("전투 참여 시 친밀도 +2", () => {
    const mon = createOwnedPokemon({ friendship: 100 });
    gainFriendshipFromBattle(mon);
    expect(mon.friendship).toBe(102);
  });

  it("친밀도는 상한(255)을 넘지 않는다", () => {
    const mon = createOwnedPokemon({ friendship: 254 });
    gainFriendshipFromBattle(mon);
    expect(mon.friendship).toBe(MAX_FRIENDSHIP);
    expect(mon.friendship).toBe(255);
  });
});
