import { describe, it, expect, beforeEach } from "vitest";
import { clearAllCaches, getSpeciesByName } from "../../src/game/data-loader.js";
import {
  calculateBattleExp,
  calculateBattleMoney,
  rollItemDrop,
  grantBattleRewards,
} from "../../src/game/battle-rewards.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import type { BattleRewardConfig, OwnedPokemon, UserData } from "../../../../shared/types.js";

const config: BattleRewardConfig = {
  expMultiplier: 1.0,
  moneyPerLevel: 2,
  moneyBase: 3,
  dropTable: [
    { item: "potion", chance: 0.08, min: 1, max: 1 },
    { item: "super-potion", chance: 0.03, min: 1, max: 1 },
    { item: "poke-ball", chance: 0.05, min: 1, max: 2 },
  ],
};

function makeUser(active: OwnedPokemon): UserData {
  return {
    account: { id: "u", password: "x", nickname: "U", createdAt: new Date().toISOString(), matchings: {} },
    currentRegion: "default",
    points: 0,
    battleMoney: 0,
    totalExp: 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: [active.uid],
    pokemon: [active],
    eggs: [],
    pokedex: [active.species],
    inventory: {},
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: [],
    log: [],
    integrations: [],
  };
}

beforeEach(() => clearAllCaches());

describe("calculateBattleExp", () => {
  it("uses the main-series formula floor(baseExp * level / 7)", () => {
    const baseExp = getSpeciesByName("charizard")!.baseExpYield!;
    expect(calculateBattleExp({ species: "charizard", level: 30 }, config)).toBe(
      Math.floor((baseExp * 30) / 7),
    );
  });

  it("scales by expMultiplier", () => {
    const doubled = { ...config, expMultiplier: 2 };
    const base = calculateBattleExp({ species: "pidgey", level: 10 }, config);
    expect(calculateBattleExp({ species: "pidgey", level: 10 }, doubled)).toBe(base * 2);
  });

  it("returns 0 for an unknown species (no base exp)", () => {
    expect(calculateBattleExp({ species: "not-a-pokemon", level: 50 }, config)).toBe(0);
  });
});

describe("calculateBattleMoney", () => {
  it("is floor(level * perLevel) + base", () => {
    expect(calculateBattleMoney(10, config)).toBe(10 * 2 + 3);
    expect(calculateBattleMoney(1, config)).toBe(1 * 2 + 3);
  });
});

describe("rollItemDrop", () => {
  it("returns the first table entry when the roll lands in its band", () => {
    const drop = rollItemDrop(config, () => 0); // 0 < 0.08 → potion
    expect(drop?.item).toBe("potion");
  });

  it("returns null when the roll exceeds the total drop chance", () => {
    expect(rollItemDrop(config, () => 0.99)).toBeNull();
  });

  it("selects the correct entry across cumulative bands", () => {
    // 0.10 → past potion(0.08), within super-potion(0.08..0.11)
    expect(rollItemDrop(config, () => 0.10)?.item).toBe("super-potion");
  });

  it("rolls quantity within [min,max]", () => {
    // land on poke-ball band (0.11..0.16) then max out quantity roll
    let calls = 0;
    const random = () => (calls++ === 0 ? 0.13 : 0.999);
    const drop = rollItemDrop(config, random);
    expect(drop?.item).toBe("poke-ball");
    expect(drop?.qty).toBe(2);
  });
});

describe("grantBattleRewards", () => {
  it("grants exp to the winner, battle money to the user, and the rolled drop", () => {
    const winner = createPokemon("charizard", 30);
    const startExp = winner.exp;
    const user = makeUser(winner);

    const rewards = grantBattleRewards(
      user,
      winner,
      { species: "pidgey", level: 10 },
      config,
      { random: () => 0, now: new Date("2026-01-01T12:00:00Z") }, // roll 0 → potion drop
    );

    const expectedExp = calculateBattleExp({ species: "pidgey", level: 10 }, config);
    expect(rewards.exp).toBe(expectedExp);
    expect(winner.exp).toBe(startExp + expectedExp);
    expect(rewards.battleMoney).toBe(calculateBattleMoney(10, config));
    expect(user.battleMoney).toBe(rewards.battleMoney);
    expect(rewards.droppedItems).toEqual([{ item: "potion", qty: 1 }]);
    expect(user.inventory.potion).toBe(1);
  });

  it("reports a level-up when enough exp is granted", () => {
    const winner = createPokemon("caterpie", 3);
    const user = makeUser(winner);
    const bigExpConfig = { ...config, expMultiplier: 1000 };

    const rewards = grantBattleRewards(
      user,
      winner,
      { species: "charizard", level: 50 },
      bigExpConfig,
      { random: () => 0.99, now: new Date("2026-01-01T12:00:00Z") }, // no drop
    );

    expect(rewards.exp).toBeGreaterThan(0);
    expect(rewards.leveledUp).toBe(true);
    expect(rewards.newLevel).toBeGreaterThan(3);
    expect(winner.level).toBe(rewards.newLevel);
    expect(rewards.droppedItems).toEqual([]);
  });
});
