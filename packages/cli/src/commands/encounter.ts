import { apiPost, apiGet } from "../api-client.js";
import { selectAction } from "../ui/prompts.js";
import { fetchArt, fetchBallArt, renderHpBar, sideBySide } from "../ui/display.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tintArt(art: string, color: string): string {
  return art
    .split("\n")
    .map((l) => `${color}${l}\x1b[0m`)
    .join("\n");
}

type PokemonInfo = { species: string; level: number; hp: number; maxHp: number };

function buildBattleScene(
  myPoke: PokemonInfo,
  wild: PokemonInfo,
  myArt: string,
  rightArt: string,
): string {
  const myLabel  = `  ${myPoke.species} Lv.${myPoke.level}`;
  const wildLabel = `  ${wild.species} Lv.${wild.level}`;
  const myHp  = `  HP: ${renderHpBar(myPoke.hp, myPoke.maxHp, 12)}`;
  const wildHp = `  HP: ${renderHpBar(wild.hp, wild.maxHp, 12)}`;
  // 아트: 4칸 오른쪽, 이름: 아트 중앙에 오도록 8칸, HP바: 그대로, 사이 간격: 6
  const indentArt = (s: string) => s.split("\n").map(l => "    " + l).join("\n");
  return [
    sideBySide(myLabel, "        " + wildLabel, 6),
    sideBySide(myArt, indentArt(rightArt), 6),
    sideBySide(myHp, wildHp, 6),
  ].join("\n");
}

function shiftArt(art: string, offset: number): string {
  return art.split("\n").map((l) => {
    if (offset > 0) return " ".repeat(offset) + l;
    const spaces = l.match(/^ */)?.[0].length ?? 0;
    return l.slice(Math.min(-offset, spaces));
  }).join("\n");
}

async function playBallThrowAnimation(
  myPoke: PokemonInfo,
  wild: PokemonInfo,
  myArt: string,
  wildArt: string,
  ballArt: string,
  catchResultPromise: Promise<{ data: unknown; ok: boolean }>,
): Promise<{ data: unknown; ok: boolean }> {
  let lineCount = 0;

  // 볼 하단 2칸 패딩 → HP바에서 2줄 위에 표시
  const padded = ballArt + "\n\n";

  const draw = (rightArt: string) => {
    const content = buildBattleScene(myPoke, wild, myArt, rightArt);
    const lines = content.split("\n");
    let out = "\x1b[?25l";
    if (lineCount > 0) {
      // 지우지 않고 줄 단위로 덮어쓰기 → 빈 프레임 없음
      out += `\x1b[${lineCount}A`;
      out += lines.map(l => "\r" + l + "\x1b[K").join("\n") + "\n";
    } else {
      out += "\x1b[2J\x1b[H";
      out += content + "\n";
    }
    out += "\x1b[?25h";
    process.stdout.write(out);
    lineCount = lines.length;
  };

  // 1. 볼 던지기
  draw(padded);
  await sleep(350);

  // 2. 좌우 흔들기 (3회)
  for (let i = 0; i < 3; i++) {
    draw(shiftArt(padded, 2));   // 오른쪽
    await sleep(100);
    draw(shiftArt(padded, -2));  // 왼쪽
    await sleep(100);
    draw(padded);                 // 중앙
    await sleep(200);
  }

  // 3. 결과 확인
  const result = await catchResultPromise;
  const r = result.data as { result?: string; battleOver?: boolean };

  if (r.result === "caught") {
    draw(tintArt(padded, "\x1b[32m"));
    await sleep(700);
  } else {
    draw(tintArt(padded, "\x1b[31m"));
    await sleep(250);
    draw(wildArt);
    await sleep(300);
  }

  return result;
}

interface BattleResult {
  battleOver: boolean;
  result?: string;
  log?: string[];
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
    console.log("\n  \x1b[31m전투 가능한 포켓몬이 없습니다.\x1b[0m");
    console.log("  포켓몬이 모두 쓰러져 있습니다. 인벤토리에서 회복 아이템을 사용하세요.\n");
    await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
    return;
  }

  const choices = alivePokemon.map((p) => ({
    name: `${p.species.padEnd(12)} Lv.${String(p.level).padEnd(4)} HP:${p.hp}/${p.maxHp}`,
    value: p.uid,
  }));
  choices.push({ name: "← 돌아가기", value: "__back__" });

  const pokemonUid = await selectAction("출전할 포켓몬을 선택하세요:", choices);
  if (pokemonUid === "__back__") return;

  // Start battle
  const startRes = await apiPost("/api/battle/start", { eventId, pokemonUid });
  if (!startRes.ok) {
    console.error(`  전투 시작 오류: ${startRes.data.error}`);
    await selectAction("", [{ name: "확인", value: "ok" }]);
    return;
  }

  // Battle loop
  let battleOver = false;
  const battleLog: string[] = [];
  let lastWild: { species: string; level: number; hp: number; maxHp: number } | null = null;
  let lastMyPokemonUid: string | null = null;

  while (!battleOver) {
    const stateRes = await apiGet("/api/battle/state");
    if (!stateRes.ok || !stateRes.data.battleState) break;

    const state = stateRes.data.battleState as {
      wild: { species: string; level: number; hp: number; maxHp: number };
      myPokemonUid: string;
    };
    lastWild = state.wild;
    lastMyPokemonUid = state.myPokemonUid;
    const myPoke = party.find((p) => p.uid === state.myPokemonUid);

    // 화면 그리기 — art 먼저 fetch 후 한 번에 출력
    const wildArt = await fetchArt(state.wild.species);
    const myArt = myPoke ? await fetchArt(myPoke.species) : null;

    if (wildArt && myArt) {
      const scene = buildBattleScene(myPoke!, state.wild, myArt, wildArt);
      process.stdout.write("\x1b[?25l\x1b[2J\x1b[H" + scene + "\n\x1b[?25h");
    } else {
      process.stdout.write("\x1b[?25l\x1b[2J\x1b[H");
      if (myPoke) {
        console.log(`  ${myPoke.species} Lv.${myPoke.level}`);
        if (myArt) console.log(myArt);
        console.log(`  HP: ${renderHpBar(myPoke.hp, myPoke.maxHp)}`);
      }
      console.log(`\n  ${state.wild.species} Lv.${state.wild.level}`);
      if (wildArt) console.log(wildArt);
      console.log(`  HP: ${renderHpBar(state.wild.hp, state.wild.maxHp)}`);
      process.stdout.write("\x1b[?25h");
    }

    // 현재 포켓몬이 쓰러진 경우 강제 교체
    if (myPoke && myPoke.hp <= 0) {
      const DIM2 = "\x1b[90m";
      const R2 = "\x1b[0m";
      console.log(`\n  ${DIM2}${"─".repeat(40)}${R2}`);
      console.log(`  \x1b[31m${myPoke.species}이(가) 쓰러졌다!\x1b[0m`);
      console.log(`  ${DIM2}${"─".repeat(40)}${R2}\n`);

      const alive = party.filter((p) => p.hp > 0);
      if (alive.length === 0) break;

      const switchChoices = alive.map((p) => ({
        name: `${p.species} Lv.${p.level} HP:${p.hp}/${p.maxHp}`,
        value: p.uid,
      }));

      const newUid = await selectAction("교체할 포켓몬을 선택하세요:", switchChoices);
      const switchRes = await apiPost("/api/battle/action", {
        action: "switch",
        data: { pokemonUid: newUid, forced: true },
      });
      const sr = switchRes.data as { log?: string[] };
      if (Array.isArray(sr.log)) {
        for (const msg of sr.log) battleLog.push(msg);
      }

      // 파티 HP 갱신
      const refreshAfterSwitch = await apiGet("/api/game/party");
      if (refreshAfterSwitch.ok) {
        const newParty = refreshAfterSwitch.data.party as typeof party;
        for (const p of party) {
          const updated = newParty.find((n) => n.uid === p.uid);
          if (updated) { p.hp = updated.hp; p.maxHp = updated.maxHp; }
        }
      }
      continue;
    }

    // 배틀 로그 (최근 2줄)
    const DIM = "\x1b[90m";
    const R = "\x1b[0m";
    console.log(`\n  ${DIM}${"─".repeat(40)}${R}`);
    const recent = battleLog.slice(-2);
    if (recent.length === 0) {
      console.log(`  ${DIM}전투 시작!${R}`);
    } else {
      for (const log of recent) {
        console.log(`  ${log}`);
      }
    }
    console.log(`  ${DIM}${"─".repeat(40)}${R}`);
    console.log();

    const action = await selectAction("행동을 선택하세요:", [
      { name: "싸우기", value: "fight" },
      { name: "몬스터볼", value: "catch" },
      { name: "아이템", value: "item" },
      { name: "포켓몬 교체", value: "switch" },
      { name: "도망치기", value: "run" },
    ]);

    let actionData: Record<string, unknown> = {};

    if (action === "fight") {
      const moveRes = await apiGet("/api/battle/state");
      const bs = moveRes.data.battleState as { myPokemonUid: string };
      const detailRes = await apiGet(`/api/game/pokemon/${bs.myPokemonUid}`);
      const moves = (detailRes.data.pokemon as { moves: Array<{ id: string; pp: number; maxPp: number }> })?.moves || [];

      const moveChoices = moves.map((m) => ({
        name: `${m.id} (PP: ${m.pp}/${m.maxPp})`,
        value: m.id,
      }));
      moveChoices.push({ name: "← 돌아가기", value: "__back__" });

      const moveId = await selectAction("기술을 선택하세요:", moveChoices);
      if (moveId === "__back__") continue;
      actionData = { moveId };
    } else if (action === "catch") {
      const invRes = await apiGet("/api/game/inventory");
      const inv = invRes.data.inventory as Record<string, number>;
      const balls = Object.entries(inv)
        .filter(([k]) => k.includes("ball"))
        .filter(([, v]) => v > 0);

      if (balls.length === 0) {
        console.log("  몬스터볼이 없습니다!");
        await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
        continue;
      }
      const ballChoices = balls.map(([k, v]) => ({ name: `${k} (${v}개)`, value: k }));
      ballChoices.push({ name: "← 돌아가기", value: "__back__" });

      const ballType = await selectAction("볼을 선택하세요:", ballChoices);
      if (ballType === "__back__") continue;

      // API 요청 즉시 시작 (애니메이션과 병렬)
      const catchPromise = apiPost("/api/battle/action", { action: "catch", data: { ball: ballType } });

      // 볼 아트 로드 + 애니메이션 재생
      if (myPoke && myArt && wildArt) {
        const ballArtStr = await fetchBallArt(ballType);
        if (ballArtStr) {
          await playBallThrowAnimation(
            myPoke,
            state.wild,
            myArt,
            wildArt,
            ballArtStr,
            catchPromise,
          );
        }
      }

      const catchResult = await catchPromise;
      const r = catchResult.data as BattleResult;

      if (r.message) battleLog.push(r.message);
      if (Array.isArray(r.log)) {
        for (const msg of r.log as string[]) battleLog.push(msg);
      }
      if (r.caught) battleLog.push("\x1b[33m포획 성공!\x1b[0m");
      if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);
      if (r.battleOver) {
        battleOver = true;
        if (r.result === "caught") battleLog.push("\x1b[33m포켓몬을 잡았다!\x1b[0m");
        else if (r.result === "victory") battleLog.push("\x1b[32m전투 승리!\x1b[0m");
        else if (r.result === "defeat") battleLog.push("\x1b[31m전투 패배...\x1b[0m");
      }

      const refreshCatch = await apiGet("/api/game/party");
      if (refreshCatch.ok) {
        const np = refreshCatch.data.party as typeof party;
        for (const p of party) {
          const u = np.find((n) => n.uid === p.uid);
          if (u) { p.hp = u.hp; p.maxHp = u.maxHp; }
        }
      }
      continue;
    } else if (action === "item") {
      const invRes = await apiGet("/api/game/inventory");
      const inv = invRes.data.inventory as Record<string, number>;
      const healItems = Object.entries(inv)
        .filter(([k]) => k.includes("potion"))
        .filter(([, v]) => v > 0);

      if (healItems.length === 0) {
        console.log("  사용 가능한 아이템이 없습니다!");
        await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
        continue;
      }
      const itemChoices = healItems.map(([k, v]) => ({ name: `${k} (${v}개)`, value: k }));
      itemChoices.push({ name: "← 돌아가기", value: "__back__" });

      const itemId = await selectAction("아이템을 선택하세요:", itemChoices);
      if (itemId === "__back__") continue;
      actionData = { itemId, targetUid: state.myPokemonUid };
    } else if (action === "switch") {
      const alive = party.filter((p) => p.hp > 0 && p.uid !== state.myPokemonUid);
      if (alive.length === 0) {
        console.log("  교체할 수 있는 포켓몬이 없습니다!");
        await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
        continue;
      }
      const switchChoices = alive.map((p) => ({
        name: `${p.species} Lv.${p.level} HP:${p.hp}/${p.maxHp}`,
        value: p.uid,
      }));
      switchChoices.push({ name: "← 돌아가기", value: "__back__" });

      const uid = await selectAction("교체할 포켓몬:", switchChoices);
      if (uid === "__back__") continue;
      actionData = { pokemonUid: uid };
    }

    const result = await apiPost("/api/battle/action", { action, data: actionData });
    const r = result.data as BattleResult;

    if (r.message) battleLog.push(r.message);
    if (Array.isArray(r.log)) {
      for (const msg of r.log as string[]) {
        battleLog.push(msg);
      }
    }
    if (r.caught) battleLog.push("\x1b[33m포획 성공!\x1b[0m");
    if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);

    if (r.battleOver) {
      battleOver = true;
      if (r.result === "victory") battleLog.push("\x1b[32m전투 승리!\x1b[0m");
      else if (r.result === "defeat") battleLog.push("\x1b[31m전투 패배...\x1b[0m");
      else if (r.result === "run") battleLog.push("도망쳤다!");
      else if (r.result === "caught") battleLog.push("\x1b[33m포켓몬을 잡았다!\x1b[0m");
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

  // 전투 종료 — 결과 화면
  if (battleLog.length > 0) {
    const DIM = "\x1b[90m";
    const R = "\x1b[0m";
    process.stdout.write("\x1b[2J\x1b[H");

    const lastResult = battleLog[battleLog.length - 1];
    const isDefeat = lastResult?.includes("전투 패배");
    const isRun = lastResult?.includes("도망쳤다");

    const myPoke = party.find((p) => p.uid === (lastMyPokemonUid ?? "")) ?? null;

    if (myPoke && lastWild) {
      const myArt = await fetchArt(myPoke.species);
      const wildArt = await fetchArt(lastWild.species);
      if (myArt && wildArt) {
        const scene = buildBattleScene(myPoke, lastWild, myArt, wildArt);
        process.stdout.write("\x1b[?25l" + scene + "\n\x1b[?25h");
      } else {
        if (myArt) {
          console.log(`  ${myPoke.species} Lv.${myPoke.level}`);
          console.log(myArt);
          console.log(`  HP: ${renderHpBar(myPoke.hp, myPoke.maxHp)}`);
        }
        if (wildArt) {
          console.log(`  ${lastWild.species} Lv.${lastWild.level}`);
          console.log(wildArt);
        }
      }
    }

    console.log(`\n  ${DIM}${"─".repeat(40)}${R}`);
    for (const log of battleLog.slice(-3)) {
      console.log(`  ${log}`);
    }
    console.log(`  ${DIM}${"─".repeat(40)}${R}`);
    await selectAction("", [{ name: "확인", value: "ok" }]);
  }
}
