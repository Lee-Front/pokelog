import { describe, it, expect } from "vitest";
import { chooseAiAction } from "../../src/pvp/pvp-ai.js";
import type { PvpPokemon, PvpPlayerState } from "../../../../shared/pvp-types.js";
import { defaultStatStages } from "../../src/game/battle.js";

function makePoke(species: string, hp = 100, moves = ["tackle"]): PvpPokemon {
  return {
    uid: species, species, level: 50, hp, maxHp: 100,
    stats: { attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    moves: moves.map((m) => ({ id: m, pp: 10, maxPp: 10 })),
    statusCondition: null,
  };
}

function makeState(party: PvpPokemon[], active = 0): PvpPlayerState {
  return {
    userId: "ai", nickname: "AI", party, activeIndex: active,
    statStages: defaultStatStages(), volatiles: [],
    ready: true, actionSubmitted: false,
  };
}

describe("pvp-ai", () => {
  it("always returns a valid action", () => {
    const ai = makeState([makePoke("pikachu")]);
    const opp = makeState([makePoke("bulbasaur")]);
    const action = chooseAiAction(ai, opp);
    expect(["fight", "switch"]).toContain(action.type);
  });

  it("uses fight when only one pokemon alive", () => {
    const ai = makeState([makePoke("pikachu")]);
    const opp = makeState([makePoke("bulbasaur")]);
    const action = chooseAiAction(ai, opp);
    expect(action.type).toBe("fight");
  });

  it("never switches to fainted pokemon", () => {
    const ai = makeState([makePoke("pikachu", 50), makePoke("charizard", 0)]);
    const opp = makeState([makePoke("squirtle")]);
    for (let i = 0; i < 20; i++) {
      const action = chooseAiAction(ai, opp);
      if (action.type === "switch") {
        expect((action as any).pokemonIndex).not.toBe(1);
      }
    }
  });

  it("uses mega evolution when available and not yet used", () => {
    const poke = makePoke("charizard");
    poke.megaForm = { variantId: "charizard-mega-x", maxHp: 120, stats: poke.stats };
    const ai = makeState([poke]);
    ai.hasKeyStone = true;
    ai.transformationUsed = false;
    const opp = makeState([makePoke("bulbasaur")]);
    const action = chooseAiAction(ai, opp);
    expect(action.type).toBe("fight");
    if (action.type === "fight") {
      expect(action.mega).toBe(true);
    }
  });

  it("does NOT mega evolve if transformation already used", () => {
    const poke = makePoke("charizard");
    poke.megaForm = { variantId: "charizard-mega-x", maxHp: 120, stats: poke.stats };
    const ai = makeState([poke]);
    ai.hasKeyStone = true;
    ai.transformationUsed = true;
    const opp = makeState([makePoke("bulbasaur")]);
    const action = chooseAiAction(ai, opp);
    expect(action.type).toBe("fight");
    if (action.type === "fight") {
      expect(action.mega).toBeUndefined();
    }
  });

  it("uses gigantamax when available and not yet used", () => {
    const poke = makePoke("pikachu");
    poke.gmaxForm = { variantId: "pikachu-gmax", maxHp: 130, stats: poke.stats };
    const ai = makeState([poke]);
    ai.hasDynamaxBand = true;
    ai.transformationUsed = false;
    const opp = makeState([makePoke("bulbasaur")]);
    const action = chooseAiAction(ai, opp);
    expect(action.type).toBe("fight");
    if (action.type === "fight") {
      expect(action.gigantamax).toBe(true);
    }
  });
});
