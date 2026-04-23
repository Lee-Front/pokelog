import { apiGet, apiPost } from "../api-client.js";
import { BLD, CYN, DIM, GRN, R, RED, YEL } from "../ui/colors.js";
import { renderHpBar } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { clearScreen, redraw } from "../ui/screen.js";
import { padRight } from "../ui/text.js";

interface PvpMove {
  id: string;
  pp: number;
  maxPp: number;
}

interface PvpPokemonView {
  uid: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  moves: PvpMove[];
  teraType?: string | null;
}

interface TowerRoomState {
  roomId: string;
  turn: number;
  phase: "team_preview" | "action" | "forced_switch" | "finished";
  me: {
    userId: string;
    activeIndex: number;
    party: PvpPokemonView[];
  };
  opponent: {
    nickname: string;
    activePokemon: PvpPokemonView | null;
    partyHpRatios: number[];
  };
  log?: string[];
  result?: { winnerId: string | null; loserId: string | null; reason: string };
  forcedSwitchNeeded?: { a: boolean; b: boolean };
}

type TowerMode = "start" | "status" | "forfeit" | "continue" | null;

export async function towerCommand(): Promise<void> {
  const status = await apiGet("/api/tower/status");
  if (!status.ok) {
    console.log(`${RED}오류: ${status.data.error ?? "상태를 불러오지 못했습니다"}${R}`);
    return;
  }
  const record = (status.data.record ?? null) as
    | { currentStreak: number; bestStreak: number; totalClears: number } | null;
  const activeRun = (status.data.activeRun ?? null) as
    | { stage: number; roomId?: string } | null;

  const mode = await selectMode(record, activeRun);
  if (!mode) return;

  if (mode === "start") {
    await handleStart();
  } else if (mode === "continue") {
    await handleContinue();
  } else if (mode === "status") {
    showRecord(record);
  } else if (mode === "forfeit") {
    await handleForfeit();
  }
}

async function selectMode(
  record: { currentStreak: number; bestStreak: number; totalClears: number } | null,
  active: { stage: number; roomId?: string } | null,
): Promise<TowerMode> {
  const options: { label: string; value: TowerMode }[] = [];
  if (active?.roomId) {
    options.push({ label: `현재 배틀 이어하기 (스테이지 ${active.stage})`, value: "start" });
  } else if (active) {
    options.push({ label: `다음 스테이지 도전 (스테이지 ${active.stage})`, value: "continue" });
  } else {
    options.push({ label: "새 도전 시작", value: "start" });
  }
  options.push({ label: "기록 보기", value: "status" });
  if (active) options.push({ label: "포기", value: "forfeit" });
  options.push({ label: "취소", value: null });

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const header: string[] = [
      `  ${BLD}── 배틀 타워 ──${R}`,
      "",
    ];
    if (record) {
      header.push(`  ${DIM}현재 스트릭:${R} ${YEL}${record.currentStreak}${R}   ${DIM}최고:${R} ${GRN}${BLD}${record.bestStreak}${R}   ${DIM}누적 클리어:${R} ${record.totalClears}`);
      header.push("");
    }
    const lines = [
      ...header,
      ...options.map((o, i) => {
        const ptr = i === cursor ? `${YEL}>${R}` : " ";
        const lbl = i === cursor ? `${BLD}${o.label}${R}` : o.label;
        return `${ptr} ${lbl}`;
      }),
      "",
      `  ${DIM}↑↓ 이동  Enter 선택  Esc 취소${R}`,
    ];
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b") return null;
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < options.length - 1) cursor++;
    if (key === "\r" || key === "\n") return options[cursor].value;
  }
}

function showRecord(
  record: { currentStreak: number; bestStreak: number; totalClears: number } | null,
): void {
  clearScreen();
  if (!record) {
    console.log(`\n  ${DIM}아직 타워 기록이 없습니다.${R}\n`);
    return;
  }
  console.log(`\n  ${BLD}── 타워 기록 ──${R}`);
  console.log(`  ${DIM}현재 스트릭:${R} ${YEL}${record.currentStreak}${R}`);
  console.log(`  ${DIM}최고 스트릭:${R} ${GRN}${BLD}${record.bestStreak}${R}`);
  console.log(`  ${DIM}누적 클리어:${R} ${record.totalClears}`);
  console.log();
}

async function handleStart(): Promise<void> {
  const profile = await apiGet("/api/user/profile");
  if (!profile.ok) {
    console.log(`${RED}프로필을 불러오지 못했습니다${R}`);
    return;
  }
  const pokemon = (profile.data.pokemon ?? []) as Array<{
    uid: string; species: string; level: number; hp: number; maxHp: number;
  }>;

  const selected = await selectThreePokemon(pokemon);
  if (!selected) return;

  const partyUids = selected.map((p) => p.uid);
  const start = await apiPost("/api/tower/start", { partyUids });
  if (!start.ok) {
    const err = typeof start.data.error === "string" ? start.data.error : "타워를 시작할 수 없습니다";
    console.log(`${RED}${err}${R}`);
    return;
  }
  await battleLoop(start.data.roomState as TowerRoomState);
}

async function handleContinue(): Promise<void> {
  const res = await apiPost("/api/tower/continue", {});
  if (!res.ok) {
    console.log(`${RED}${res.data.error ?? "다음 스테이지 진입 실패"}${R}`);
    return;
  }
  await battleLoop(res.data.roomState as TowerRoomState);
}

async function handleForfeit(): Promise<void> {
  const res = await apiPost("/api/tower/forfeit", {});
  if (!res.ok) {
    console.log(`${RED}${res.data.error ?? "포기 실패"}${R}`);
    return;
  }
  console.log(`\n  ${YEL}타워 도전을 포기했습니다. 최종 스트릭: ${res.data.finalStreak}${R}\n`);
}

async function selectThreePokemon(
  all: Array<{ uid: string; species: string; level: number; hp: number; maxHp: number }>,
): Promise<typeof all | null> {
  const alive = all.filter((p) => p.hp > 0);
  if (alive.length < 3) {
    console.log(`\n  ${RED}출전 가능한 포켓몬이 3마리 미만입니다 (현재 ${alive.length})${R}\n`);
    return null;
  }

  const chosen = new Set<string>();
  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines: string[] = [
      `  ${BLD}── 타워 파티 선택 (3마리) ──${R}`,
      `  ${DIM}같은 종족 중복 불가 (Species Clause)${R}`,
      "",
    ];
    for (let i = 0; i < alive.length; i++) {
      const p = alive[i];
      const marked = chosen.has(p.uid);
      const ptr = i === cursor ? `${YEL}>${R}` : " ";
      const mark = marked ? `${GRN}[✓]${R}` : `${DIM}[ ]${R}`;
      const label = i === cursor
        ? `${BLD}${padRight(p.species, 16)}${R}`
        : padRight(p.species, 16);
      const hp = renderHpBar(p.hp, p.maxHp, 10);
      lines.push(`${ptr} ${mark} ${label} Lv.${p.level} ${hp}`);
    }
    lines.push("");
    lines.push(`  ${DIM}선택:${R} ${chosen.size}/3`);
    lines.push(`  ${DIM}↑↓ 이동  Space 선택  Enter 확정  Esc 취소${R}`);
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b") return null;
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < alive.length - 1) cursor++;
    if (key === " ") {
      const p = alive[cursor];
      if (chosen.has(p.uid)) chosen.delete(p.uid);
      else {
        // Species Clause check
        const sameSpecies = alive.some((q) => chosen.has(q.uid) && q.species === p.species);
        if (sameSpecies) continue;
        if (chosen.size < 3) chosen.add(p.uid);
      }
    }
    if (key === "\r" || key === "\n") {
      if (chosen.size !== 3) continue;
      return alive.filter((p) => chosen.has(p.uid));
    }
  }
}

async function battleLoop(initialState: TowerRoomState): Promise<void> {
  let state: TowerRoomState = initialState;
  while (true) {
    renderBattle(state);
    if (state.phase === "finished") {
      renderFinish(state);
      break;
    }

    let action: { type: "fight"; moveId: string } | { type: "switch"; pokemonIndex: number } | { type: "forfeit" } | null;
    if (state.phase === "forced_switch") {
      action = await selectSwitch(state);
      if (!action) return;
    } else {
      action = await selectAction(state);
      if (!action) return;
    }

    const res = await apiPost("/api/tower/action", { action });
    if (!res.ok) {
      console.log(`\n  ${RED}오류: ${res.data.error ?? "턴 처리 실패"}${R}\n`);
      return;
    }

    if (res.data.victory === true) {
      console.log(`\n  ${GRN}${BLD}스테이지 ${res.data.clearedStage} 클리어!${R}`);
      const reward = res.data.reward as { points: number; items: { id: string; amount: number }[] } | undefined;
      if (reward) {
        console.log(`  ${DIM}보상:${R} +${reward.points}P${reward.items.length > 0 ? ", " + reward.items.map((i) => `${i.id} x${i.amount}`).join(", ") : ""}`);
      }
      console.log(`  ${DIM}다음 스테이지로 진행하시겠습니까? (Enter 계속, Esc 중단)${R}`);
      enterRaw();
      const key = await waitKey();
      if (key === "\x1b") return;
      const cont = await apiPost("/api/tower/continue", {});
      if (!cont.ok) {
        console.log(`${RED}${cont.data.error ?? "다음 스테이지 진입 실패"}${R}`);
        return;
      }
      state = cont.data.roomState as TowerRoomState;
      continue;
    }
    if (res.data.victory === false) {
      console.log(`\n  ${RED}${BLD}패배! 최종 스트릭: ${res.data.finalStreak}${R}\n`);
      return;
    }

    state = res.data.roomState as TowerRoomState;
  }
}

function renderBattle(state: TowerRoomState): void {
  clearScreen();
  const my = state.me.party[state.me.activeIndex];
  const opp = state.opponent.activePokemon;

  console.log(`\n  ${BLD}── 배틀 타워  Turn ${state.turn} ──${R}\n`);

  if (opp) {
    const hp = renderHpBar(opp.hp, opp.maxHp, 20);
    console.log(`  ${CYN}상대:${R} ${opp.species} Lv.${opp.level}   ${hp}   ${opp.hp}/${opp.maxHp}`);
  }
  console.log(`  ${DIM}파티:${R} ${state.opponent.partyHpRatios.map((r) => r > 0 ? "●" : "○").join(" ")}`);
  console.log();

  if (my) {
    const hp = renderHpBar(my.hp, my.maxHp, 20);
    console.log(`  ${YEL}내:${R}    ${my.species} Lv.${my.level}   ${hp}   ${my.hp}/${my.maxHp}`);
  }
  const partyMarks = state.me.party.map((p) => p.hp > 0 ? "●" : "○").join(" ");
  console.log(`  ${DIM}파티:${R} ${partyMarks}`);
  console.log();

  if (state.log && state.log.length > 0) {
    console.log(`  ${DIM}── 이전 턴 ──${R}`);
    for (const line of state.log.slice(-8)) console.log(`  ${line}`);
    console.log();
  }
}

function renderFinish(state: TowerRoomState): void {
  if (!state.result) return;
  const winner = state.result.winnerId === state.me.userId;
  const isDraw = state.result.winnerId === null;
  if (isDraw) console.log(`  ${YEL}무승부${R}`);
  else if (winner) console.log(`  ${GRN}${BLD}승리!${R}`);
  else console.log(`  ${RED}${BLD}패배${R}`);
  console.log();
}

async function selectAction(
  state: TowerRoomState,
): Promise<{ type: "fight"; moveId: string } | { type: "switch"; pokemonIndex: number } | { type: "forfeit" } | null> {
  const options = [
    { label: "싸운다", value: "fight" },
    { label: "교체", value: "switch" },
    { label: "기권", value: "forfeit" },
  ] as const;

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      "",
      `  ${DIM}── 행동 선택 ──${R}`,
      ...options.map((o, i) => {
        const ptr = i === cursor ? `${YEL}>${R}` : " ";
        const lbl = i === cursor ? `${BLD}${o.label}${R}` : o.label;
        return `${ptr} ${lbl}`;
      }),
      "",
      `  ${DIM}↑↓ 이동  Enter 선택  Esc 뒤로${R}`,
    ];
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b") return null;
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < options.length - 1) cursor++;
    if (key === "\r" || key === "\n") {
      const sel = options[cursor].value;
      if (sel === "fight") {
        const move = await selectMove(state);
        if (move) return move;
        first = true; continue;
      }
      if (sel === "switch") {
        const sw = await selectSwitch(state);
        if (sw) return sw;
        first = true; continue;
      }
      if (sel === "forfeit") return { type: "forfeit" };
    }
  }
}

async function selectMove(
  state: TowerRoomState,
): Promise<{ type: "fight"; moveId: string } | null> {
  const my = state.me.party[state.me.activeIndex];
  const usable = my.moves.filter((m) => m.pp > 0);
  if (usable.length === 0) return { type: "fight", moveId: my.moves[0]?.id ?? "tackle" };

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      "",
      `  ${DIM}── 기술 선택 ──${R}`,
      ...usable.map((m, i) => {
        const ptr = i === cursor ? `${YEL}>${R}` : " ";
        const lbl = i === cursor ? `${BLD}${padRight(m.id, 18)}${R}` : padRight(m.id, 18);
        return `${ptr} ${lbl}  PP ${m.pp}/${m.maxPp}`;
      }),
      "",
      `  ${DIM}↑↓ 이동  Enter 선택  Esc 뒤로${R}`,
    ];
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b") return null;
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < usable.length - 1) cursor++;
    if (key === "\r" || key === "\n") return { type: "fight", moveId: usable[cursor].id };
  }
}

async function selectSwitch(
  state: TowerRoomState,
): Promise<{ type: "switch"; pokemonIndex: number } | null> {
  const alt = state.me.party
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.hp > 0 && i !== state.me.activeIndex);
  if (alt.length === 0) return null;

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      "",
      `  ${DIM}── 교체할 포켓몬 ──${R}`,
      ...alt.map(({ p }, idx) => {
        const ptr = idx === cursor ? `${YEL}>${R}` : " ";
        const lbl = idx === cursor ? `${BLD}${padRight(p.species, 14)}${R}` : padRight(p.species, 14);
        const hp = renderHpBar(p.hp, p.maxHp, 10);
        return `${ptr} ${lbl} Lv.${p.level} ${hp}`;
      }),
      "",
      `  ${DIM}↑↓ 이동  Enter 선택  Esc 뒤로${R}`,
    ];
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b") return null;
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < alt.length - 1) cursor++;
    if (key === "\r" || key === "\n") return { type: "switch", pokemonIndex: alt[cursor].i };
  }
}
