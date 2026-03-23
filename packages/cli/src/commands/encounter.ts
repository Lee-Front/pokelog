import { apiPost, apiGet } from "../api-client.js";
import { selectAction } from "../ui/prompts.js";
import { renderPokemonArt, renderHpBar } from "../ui/display.js";

interface BattleResult {
  battleOver: boolean;
  result?: string;
  playerDamage?: number;
  wildDamage?: number;
  caught?: boolean;
  missed?: boolean;
  effectiveness?: number;
  message?: string;
  rewards?: { exp: number; points: number };
  wildHp?: number;
  wildMaxHp?: number;
  myHp?: number;
  myMaxHp?: number;
  wild?: { species: string; level: number; hp: number; maxHp: number };
  myPokemon?: { species: string; level: number; hp: number; maxHp: number };
  [key: string]: unknown;
}

export async function encounterCommand(eventId: string) {
  // Get party to select pokemon
  const partyRes = await apiGet("/api/game/party");
  if (!partyRes.ok) {
    console.error(`오류: ${partyRes.data.error}`);
    return;
  }

  const party = partyRes.data.party as Array<{
    uid: string;
    species: string;
    level: number;
    hp: number;
    maxHp: number;
  }>;

  const alivePokemon = party.filter((p) => p.hp > 0);
  if (alivePokemon.length === 0) {
    console.log("전투 가능한 포켓몬이 없습니다. 회복 아이템을 사용하세요.");
    return;
  }

  const pokemonUid = await selectAction(
    "출전할 포켓몬을 선택하세요:",
    alivePokemon.map((p) => ({
      name: `${p.species} Lv.${p.level} HP:${p.hp}/${p.maxHp}`,
      value: p.uid,
    }))
  );

  // Start battle
  const startRes = await apiPost("/api/battle/start", { eventId, pokemonUid });
  if (!startRes.ok) {
    console.error(`오류: ${startRes.data.error}`);
    return;
  }

  // Battle loop
  let battleOver = false;
  while (!battleOver) {
    const stateRes = await apiGet("/api/battle/state");
    if (!stateRes.ok || !stateRes.data.battleState) break;

    const state = stateRes.data.battleState as {
      wild: { species: string; level: number; hp: number; maxHp: number };
      myPokemonUid: string;
    };
    const myPoke = party.find((p) => p.uid === state.myPokemonUid);

    console.log(`\n야생 ${state.wild.species} Lv.${state.wild.level}`);
    renderPokemonArt(state.wild.species);
    console.log(`  HP: ${renderHpBar(state.wild.hp, state.wild.maxHp)}`);
    if (myPoke) {
      console.log(`\n내 포켓몬: ${myPoke.species} Lv.${myPoke.level}`);
      console.log(`  HP: ${renderHpBar(myPoke.hp, myPoke.maxHp)}`);
    }

    const action = await selectAction("행동을 선택하세요:", [
      { name: "싸우기", value: "fight" },
      { name: "몬스터볼", value: "catch" },
      { name: "아이템", value: "item" },
      { name: "포켓몬 교체", value: "switch" },
      { name: "도망치기", value: "run" },
    ]);

    let actionData: Record<string, unknown> = {};

    if (action === "fight") {
      // Get moves from state
      const moveRes = await apiGet("/api/battle/state");
      const bs = moveRes.data.battleState as {
        myPokemonUid: string;
      };
      const detailRes = await apiGet(`/api/game/pokemon/${bs.myPokemonUid}`);
      const moves = (detailRes.data.pokemon as { moves: Array<{ id: string; pp: number; maxPp: number }> })?.moves || [];

      const moveId = await selectAction(
        "기술을 선택하세요:",
        moves.map((m) => ({
          name: `${m.id} (PP: ${m.pp}/${m.maxPp})`,
          value: m.id,
        }))
      );
      actionData = { moveId };
    } else if (action === "catch") {
      const invRes = await apiGet("/api/game/inventory");
      const inv = invRes.data.inventory as Record<string, number>;
      const balls = Object.entries(inv)
        .filter(([k]) => k.includes("ball"))
        .filter(([, v]) => v > 0);

      if (balls.length === 0) {
        console.log("몬스터볼이 없습니다!");
        continue;
      }
      const ballType = await selectAction(
        "볼을 선택하세요:",
        balls.map(([k, v]) => ({ name: `${k} (${v}개)`, value: k }))
      );
      actionData = { ballType };
    } else if (action === "item") {
      const invRes = await apiGet("/api/game/inventory");
      const inv = invRes.data.inventory as Record<string, number>;
      const healItems = Object.entries(inv)
        .filter(([k]) => k.includes("potion"))
        .filter(([, v]) => v > 0);

      if (healItems.length === 0) {
        console.log("사용 가능한 아이템이 없습니다!");
        continue;
      }
      const itemId = await selectAction(
        "아이템을 선택하세요:",
        healItems.map(([k, v]) => ({ name: `${k} (${v}개)`, value: k }))
      );
      actionData = { itemId, targetUid: state.myPokemonUid };
    } else if (action === "switch") {
      const alive = party.filter((p) => p.hp > 0 && p.uid !== state.myPokemonUid);
      if (alive.length === 0) {
        console.log("교체할 수 있는 포켓몬이 없습니다!");
        continue;
      }
      const uid = await selectAction(
        "교체할 포켓몬:",
        alive.map((p) => ({
          name: `${p.species} Lv.${p.level} HP:${p.hp}/${p.maxHp}`,
          value: p.uid,
        }))
      );
      actionData = { pokemonUid: uid };
    }

    const result = await apiPost("/api/battle/action", { action, data: actionData });
    const r = result.data as BattleResult;

    if (r.message) console.log(r.message);
    if (r.caught) console.log("포획 성공!");
    if (r.rewards) console.log(`보상: 경험치 ${r.rewards.exp}, 포인트 ${r.rewards.points}P`);

    if (r.battleOver) {
      battleOver = true;
      if (r.result === "victory") console.log("전투 승리!");
      else if (r.result === "defeat") console.log("전투 패배...");
      else if (r.result === "run") console.log("도망쳤다!");
      else if (r.result === "caught") console.log("포켓몬을 잡았다!");
    }

    // Refresh party HP
    const refreshRes = await apiGet("/api/game/party");
    if (refreshRes.ok) {
      const newParty = refreshRes.data.party as typeof party;
      for (const p of party) {
        const updated = newParty.find((n) => n.uid === p.uid);
        if (updated) {
          p.hp = updated.hp;
          p.maxHp = updated.maxHp;
        }
      }
    }
  }
}
