import type { PvpAction, PvpPlayerState } from "../../../../shared/pvp-types.js";
import { getMoveById, getTypeChart } from "../game/data-loader.js";
import { getEffectiveTypes } from "../game/pokemon-state.js";

export function chooseAiAction(ai: PvpPlayerState, opponent: PvpPlayerState): PvpAction {
  const myPoke = ai.party[ai.activeIndex];
  const oppPoke = opponent.party[opponent.activeIndex];
  const oppTypes = getEffectiveTypes(oppPoke.species, oppPoke.variantId, undefined);
  const typeChart = getTypeChart();

  // PP가 있는 기술만
  const usable = myPoke.moves.filter((m) => m.pp > 0);
  if (usable.length === 0) {
    return { type: "fight", moveId: myPoke.moves[0]?.id ?? "tackle" };
  }

  // 각 기술의 타입 상성 점수 계산
  const scored = usable.map((m) => {
    const data = getMoveById(m.id);
    if (!data || data.power === 0) return { moveId: m.id, score: 0 };
    let mult = 1;
    const moveChart = typeChart[data.type] ?? {};
    for (const t of oppTypes) {
      mult *= moveChart[t] ?? 1;
    }
    return { moveId: m.id, score: data.power * mult };
  });

  scored.sort((a, b) => b.score - a.score);

  // 20% 확률로 교체 시도 (HP 낮을 때)
  if (myPoke.hp < myPoke.maxHp * 0.3) {
    const aliveOthers = ai.party
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== ai.activeIndex && p.hp > 0);
    if (aliveOthers.length > 0 && Math.random() < 0.2) {
      const pick = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      return { type: "switch", pokemonIndex: pick.i };
    }
  }

  return { type: "fight", moveId: scored[0].moveId };
}
