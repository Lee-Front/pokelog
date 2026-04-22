import { io as socketIo } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { getToken, getCurrentServer } from "../config.js";
import { BLD, CYN, DIM, GRN, RED, YEL, R } from "../ui/colors.js";
import { renderHpBar } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { redraw, clearScreen } from "../ui/screen.js";
import { padRight } from "../ui/text.js";
import {
  formatFieldEffects, formatPokemonPanel, formatPartyStatus, formatOppPartyStatus,
  loadMoveCatalog, getMoveInfo, formatMoveInfo, TYPE_ABBR,
} from "../ui/battle-display.js";
import type { PvpClientRoomView, PvpAction, PvpPokemon } from "../../../../shared/pvp-types.js";

export async function pvpCommand(): Promise<void> {
  const server = await getCurrentServer();
  const token = await getToken();
  if (!server || !token) {
    console.log(`${RED}서버에 로그인되어 있지 않습니다${R}`);
    return;
  }

  // Mode selection using enterRaw + waitKey
  const mode = await selectMode();
  if (!mode) return;

  const socket = socketIo(server.url, { autoConnect: false });
  socket.connect();

  return new Promise<void>((resolve) => {
    socket.emit("pvp:auth", { token });

    socket.on("pvp:authenticated", async () => {
      if (mode === "random") {
        socket.emit("pvp:queue");
      } else if (mode === "create") {
        socket.emit("pvp:create_room");
      } else if (mode === "join") {
        // Ask for room code
        process.stdin.setRawMode?.(false);
        const code = await promptRoomCode();
        if (code) {
          socket.emit("pvp:join_room", { roomId: code });
        } else {
          socket.disconnect();
          resolve();
        }
      } else if (mode === "ai") {
        socket.emit("pvp:ai_battle");
      }
    });

    socket.on("pvp:queued", () => {
      clearScreen();
      console.log(`\n  ${CYN}${BLD}매칭 대기 중...${R}`);
      console.log(`  ${DIM}Ctrl+C로 취소${R}\n`);
    });

    socket.on("pvp:room_created", (data: { roomId: string }) => {
      clearScreen();
      console.log(`\n  ${GRN}${BLD}방 생성됨${R}`);
      console.log(`  ${DIM}방 코드:${R} ${YEL}${BLD}${data.roomId}${R}`);
      console.log(`  ${DIM}상대에게 이 코드를 공유하세요${R}`);
      console.log(`  ${DIM}대기 중...${R}\n`);
    });

    socket.on("pvp:matched", (data: { roomId: string; opponent: string }) => {
      clearScreen();
      console.log(`\n  ${GRN}${BLD}매칭 완료!${R} 상대: ${CYN}${data.opponent}${R}\n`);
    });

    socket.on("pvp:room_state", async (state: PvpClientRoomView) => {
      await handleState(socket, state, resolve);
    });

    socket.on("pvp:turn_result", async (data: { log: string[]; state: PvpClientRoomView }) => {
      // Print turn log
      clearScreen();
      console.log(`\n  ${DIM}── 턴 결과 ──${R}`);
      for (const msg of data.log) {
        console.log(`  ${msg}`);
      }
      console.log();

      // Wait for user to read
      enterRaw();
      console.log(`  ${DIM}아무 키나 눌러 계속...${R}`);
      await waitKey();

      await handleState(socket, data.state, resolve);
    });

    socket.on("pvp:opponent_disconnected", () => {
      console.log(`\n  ${YEL}상대가 연결을 끊었습니다${R}\n`);
      socket.disconnect();
      resolve();
    });

    socket.on("pvp:error", (data: { message: string }) => {
      console.log(`  ${RED}에러: ${data.message}${R}`);
    });

    socket.on("disconnect", () => resolve());
  });
}

async function handleState(
  socket: Socket,
  state: PvpClientRoomView,
  resolve: () => void,
): Promise<void> {
  if (state.phase === "team_preview") {
    await handleTeamPreview(socket, state);
  } else if (state.phase === "action") {
    await handleBattleTurn(socket, state);
  } else if (state.phase === "forced_switch") {
    await handleForcedSwitch(socket, state);
  } else if (state.phase === "finished") {
    handleFinish(state);
    socket.disconnect();
    resolve();
  }
}

async function selectMode(): Promise<"random" | "create" | "join" | "ai" | null> {
  const options: { label: string; value: "random" | "create" | "join" | "ai" | null }[] = [
    { label: "랜덤 매칭", value: "random" },
    { label: "방 생성",   value: "create" },
    { label: "방 참가",   value: "join" },
    { label: "AI 대전",   value: "ai" },
    { label: "취소",      value: null },
  ];

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      `  ${BLD}── PvP 대전 ──${R}`,
      "",
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

async function promptRoomCode(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let value = "";
    let lineCount = 0;
    let first = true;
    enterRaw();

    const draw = () => {
      const lines = [
        `  ${BLD}방 코드 입력${R}`,
        `  ${YEL}>${R} ${value}`,
        "",
        `  ${DIM}Enter 확인  Esc 취소${R}`,
      ];
      lineCount = redraw(lines, lineCount, first);
      first = false;
    };

    const onKey = async () => {
      draw();
      const key = await waitKey();
      if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
      if (key === "\x1b") { resolve(null); return; }
      if (key === "\r" || key === "\n") {
        resolve(value.trim() || null);
        return;
      }
      if (key === "\x7f" || key === "\b") {
        value = value.slice(0, -1);
      } else if (key.length === 1 && key >= " ") {
        value += key;
      }
      onKey();
    };
    onKey();
  });
}

async function handleTeamPreview(socket: Socket, state: PvpClientRoomView): Promise<void> {
  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      `  ${BLD}── 선발 포켓몬 선택 ──${R}`,
      `  ${DIM}vs ${state.opponent.nickname}${R}`,
      "",
      ...state.me.party.map((p, i) => {
        const ptr = i === cursor ? `${YEL}>${R}` : " ";
        const hp = renderHpBar(p.hp, p.maxHp, 10);
        const lbl = i === cursor ? `${BLD}${padRight(p.species, 14)}${R}` : padRight(p.species, 14);
        return `${ptr} ${lbl} Lv.${p.level} ${hp}`;
      }),
      "",
      `  ${DIM}↑↓ 이동  Enter 선택${R}`,
    ];
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < state.me.party.length - 1) cursor++;
    if (key === "\r" || key === "\n") {
      socket.emit("pvp:select_lead", { pokemonIndex: cursor });
      clearScreen();
      console.log(`\n  ${DIM}상대 선택 대기 중...${R}\n`);
      return;
    }
  }
}

async function handleBattleTurn(socket: Socket, state: PvpClientRoomView): Promise<void> {
  // Prime move catalog in the background (non-blocking)
  loadMoveCatalog().catch(() => {});

  const my = state.me.party[state.me.activeIndex];
  const opp = state.opponent.activePokemon;
  if (!opp) return;

  const me = state.me;
  const canMega = !me.transformationUsed && !!me.hasKeyStone && my.megaForm != null;
  const canGmax = !me.transformationUsed && !!me.hasDynamaxBand && my.gmaxForm != null;
  const canDynamax = !me.transformationUsed && !!me.hasDynamaxBand && my.gmaxForm == null;
  const canUltraBurst = !me.transformationUsed && my.ultraForm != null;
  const canTera = !me.transformationUsed && my.teraType != null;

  const menuItems: { label: string; value: string }[] = [
    { label: "싸운다", value: "fight" },
  ];
  if (canMega) menuItems.push({ label: "메가진화 + 싸운다", value: "mega" });
  if (canGmax) menuItems.push({ label: "기가맥스 + 싸운다", value: "gmax" });
  if (canDynamax) menuItems.push({ label: "다이맥스 + 싸운다", value: "dynamax" });
  if (canUltraBurst) menuItems.push({ label: "울트라버스트 + 싸운다", value: "ultra" });
  if (canTera) {
    const tlabel = my.teraType ? TYPE_ABBR[my.teraType] ?? my.teraType : "";
    menuItems.push({ label: `테라스탈(${tlabel}) + 싸운다`, value: "tera" });
  }
  menuItems.push({ label: "교체", value: "switch" });
  menuItems.push({ label: "기권", value: "forfeit" });

  // Main battle menu
  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = buildBattleLines(state, my, opp, menuItems, cursor);
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < menuItems.length - 1) cursor++;
    if (key === "\r" || key === "\n") {
      const selected = menuItems[cursor].value;
      if (
        selected === "fight" || selected === "mega" || selected === "gmax" ||
        selected === "dynamax" || selected === "ultra" || selected === "tera"
      ) {
        const moveAction = await selectMove(state, my, opp);
        if (moveAction && moveAction.type === "fight") {
          if (selected === "mega") moveAction.mega = true;
          if (selected === "gmax") moveAction.gigantamax = true;
          if (selected === "dynamax") moveAction.dynamax = true;
          if (selected === "ultra") moveAction.ultraBurst = true;
          if (selected === "tera") moveAction.tera = true;
          socket.emit("pvp:action", { action: moveAction });
          clearScreen();
          console.log(`\n  ${DIM}상대 행동 대기 중...${R}\n`);
          return;
        }
        lineCount = 0; first = true; cursor = 0;
        continue;
      } else if (selected === "switch") {
        const switchAction = await selectSwitch(state);
        if (switchAction) {
          socket.emit("pvp:action", { action: switchAction });
          clearScreen();
          console.log(`\n  ${DIM}상대 행동 대기 중...${R}\n`);
          return;
        }
        lineCount = 0; first = true; continue;
      } else if (selected === "forfeit") {
        socket.emit("pvp:action", { action: { type: "forfeit" } });
        return;
      }
    }
  }
}

function buildBattleLines(
  state: PvpClientRoomView,
  my: PvpPokemon,
  opp: PvpPokemon,
  menuItems: { label: string; value: string }[],
  cursor: number,
): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${BLD}Turn ${state.turn}${R}`);

  // Field effects
  const fx = formatFieldEffects(state);
  if (fx.length > 0) lines.push(...fx);
  lines.push("");

  // Opponent panel
  const oppLines = formatPokemonPanel({
    poke: opp,
    transformationType: state.opponent.transformationType,
    gmaxTurnsRemaining: state.opponent.gmaxTurnsRemaining,
    statStages: state.opponent.statStages,
    volatiles: state.opponent.volatiles,
    substitute: state.opponent.substitute,
    teraActive: state.opponent.teraActive,
    isOpponent: true,
  });
  lines.push(...oppLines);
  lines.push("");

  // My panel
  const myLines = formatPokemonPanel({
    poke: my,
    transformationType: state.me.transformationType,
    gmaxTurnsRemaining: state.me.gmaxTurnsRemaining,
    statStages: state.me.statStages,
    volatiles: state.me.volatiles,
    substitute: state.me.substitute,
    teraActive: state.me.teraActive,
    isOpponent: false,
  });
  lines.push(...myLines);
  lines.push("");

  // Party bars
  lines.push(formatPartyStatus(state));
  lines.push(formatOppPartyStatus(state));
  lines.push("");

  lines.push(`  ${DIM}─────────────────────────${R}`);
  for (let i = 0; i < menuItems.length; i++) {
    const item = menuItems[i];
    const ptr = i === cursor ? `${YEL}>${R}` : " ";
    const lbl = i === cursor ? `${BLD}${item.label}${R}` : item.label;
    lines.push(`  ${ptr} ${lbl}`);
  }
  lines.push("");
  lines.push(`  ${DIM}↑↓ 이동  Enter 선택${R}`);
  return lines;
}

async function selectMove(
  _state: PvpClientRoomView,
  my: PvpPokemon,
  _opp: PvpPokemon,
): Promise<PvpAction | null> {
  const moves = my.moves.filter((m) => m.pp > 0);
  if (moves.length === 0) {
    // Struggle — use first move even if pp=0
    return { type: "fight", moveId: my.moves[0]?.id ?? "tackle" };
  }

  // Ensure move catalog loaded for type/category/power display
  await loadMoveCatalog();

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      "",
      `  ${BLD}── 기술 선택 ──${R}`,
      "",
      ...moves.map((m, i) => {
        const ptr = i === cursor ? `${YEL}>${R}` : " ";
        const name = padRight(m.id, 18);
        const lbl = i === cursor ? `${BLD}${name}${R}` : name;
        const info = formatMoveInfo(getMoveInfo(m.id));
        return `  ${ptr} ${lbl} ${info}  PP ${m.pp}/${m.maxPp}`;
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
    if (key === "\x1b[B" && cursor < moves.length - 1) cursor++;
    if (key === "\r" || key === "\n") {
      return { type: "fight", moveId: moves[cursor].id };
    }
  }
}

async function selectSwitch(state: PvpClientRoomView): Promise<PvpAction | null> {
  const alive = state.me.party
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.hp > 0 && i !== state.me.activeIndex);

  if (alive.length === 0) {
    return null;
  }

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      "",
      `  ${BLD}── 교체할 포켓몬 ──${R}`,
      "",
      ...alive.map(({ p, i: _i }, idx) => {
        const ptr = idx === cursor ? `${YEL}>${R}` : " ";
        const hp = renderHpBar(p.hp, p.maxHp, 10);
        const lbl = idx === cursor ? `${BLD}${padRight(p.species, 14)}${R}` : padRight(p.species, 14);
        return `  ${ptr} ${lbl} Lv.${p.level} ${hp}`;
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
    if (key === "\x1b[B" && cursor < alive.length - 1) cursor++;
    if (key === "\r" || key === "\n") {
      return { type: "switch", pokemonIndex: alive[cursor].i };
    }
  }
}

async function handleForcedSwitch(socket: Socket, state: PvpClientRoomView): Promise<void> {
  const alive = state.me.party
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.hp > 0 && i !== state.me.activeIndex);

  if (alive.length === 0) return;

  let cursor = 0;
  let lineCount = 0;
  let first = true;
  enterRaw();

  while (true) {
    const lines = [
      "",
      `  ${YEL}${BLD}포켓몬이 쓰러졌다!${R}`,
      `  ${DIM}교체할 포켓몬을 선택하세요${R}`,
      "",
      ...alive.map(({ p }, idx) => {
        const ptr = idx === cursor ? `${YEL}>${R}` : " ";
        const hp = renderHpBar(p.hp, p.maxHp, 10);
        const lbl = idx === cursor ? `${BLD}${padRight(p.species, 14)}${R}` : padRight(p.species, 14);
        return `  ${ptr} ${lbl} Lv.${p.level} ${hp}`;
      }),
      "",
      `  ${DIM}↑↓ 이동  Enter 선택${R}`,
    ];
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b[A" && cursor > 0) cursor--;
    if (key === "\x1b[B" && cursor < alive.length - 1) cursor++;
    if (key === "\r" || key === "\n") {
      socket.emit("pvp:action", { action: { type: "switch", pokemonIndex: alive[cursor].i } });
      clearScreen();
      console.log(`\n  ${DIM}상대 행동 대기 중...${R}\n`);
      return;
    }
  }
}

function handleFinish(state: PvpClientRoomView): void {
  clearScreen();
  if (!state.result) return;
  const isWinner = state.result.winnerId === state.me.userId;
  const isDraw = state.result.winnerId === null;

  console.log(`\n  ${DIM}── 대전 결과 ──${R}\n`);
  if (isDraw) {
    console.log(`  ${YEL}${BLD}무승부!${R}`);
  } else if (isWinner) {
    console.log(`  ${GRN}${BLD}승리!${R} ${DIM}(+100P)${R}`);
  } else {
    console.log(`  ${RED}${BLD}패배...${R} ${DIM}(+20P)${R}`);
  }
  console.log(`  ${DIM}사유: ${state.result.reason}${R}\n`);
}
